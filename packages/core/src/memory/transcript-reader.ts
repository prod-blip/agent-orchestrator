/**
 * Transcript Reader — reads agent JSONL transcripts for memory extraction.
 *
 * Supports:
 * - Claude Code: ~/.claude/projects/{encoded-path}/session-*.jsonl
 * - Codex: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl (matched by cwd)
 *
 * Note: Transcripts can be large (megabytes). This module provides streaming
 * utilities and size-capped reading to avoid memory issues.
 */

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { MAX_TRANSCRIPT_BYTES } from "./types.js";

// =============================================================================
// TYPES
// =============================================================================

export interface TranscriptEntry {
  type: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string }>;
  };
  tool_use?: {
    name?: string;
    input?: Record<string, unknown>;
  };
  result?: unknown;
  timestamp?: string;
  [key: string]: unknown;
}

export interface TranscriptReadResult {
  /** Parsed transcript entries */
  entries: TranscriptEntry[];
  /** Path to the transcript file */
  filePath: string;
  /** Whether the transcript was truncated due to size */
  truncated: boolean;
  /** Original file size in bytes */
  originalSize: number;
}

// =============================================================================
// CLAUDE CODE TRANSCRIPT
// =============================================================================

/**
 * Encode a path for Claude Code's project directory structure.
 * Claude Code uses a specific encoding for paths in ~/.claude/projects/
 */
function encodeClaudeProjectPath(projectPath: string): string {
  // Claude Code encodes paths by replacing / with -
  // and prepending with a hyphen
  return "-" + projectPath.replace(/\//g, "-").replace(/^-/, "");
}

/**
 * Find Claude Code session files for a project.
 * Returns paths sorted by modification time (most recent first).
 */
async function findClaudeCodeSessionFiles(projectPath: string): Promise<string[]> {
  const claudeProjectsDir = join(homedir(), ".claude", "projects");
  const encodedPath = encodeClaudeProjectPath(projectPath);
  const projectDir = join(claudeProjectsDir, encodedPath);

  if (!existsSync(projectDir)) {
    return [];
  }

  try {
    const files = await readdir(projectDir);
    const sessionFiles = files.filter(
      (f) => f.startsWith("session-") && f.endsWith(".jsonl"),
    );

    // Get file stats for sorting
    const withStats = await Promise.all(
      sessionFiles.map(async (f) => {
        const filePath = join(projectDir, f);
        const stats = await stat(filePath);
        return { path: filePath, mtime: stats.mtime.getTime() };
      }),
    );

    // Sort by mtime descending (most recent first)
    withStats.sort((a, b) => b.mtime - a.mtime);

    return withStats.map((f) => f.path);
  } catch {
    return [];
  }
}

/**
 * Read Claude Code transcript for a session.
 * Finds the most recent session file for the given project path.
 *
 * @param projectPath - Absolute path to the project (used to find Claude's project dir)
 * @param agentSessionId - Optional specific session ID to find
 * @param maxBytes - Maximum bytes to read (default: MAX_TRANSCRIPT_BYTES)
 */
export async function readClaudeCodeTranscript(
  projectPath: string,
  agentSessionId?: string,
  maxBytes: number = MAX_TRANSCRIPT_BYTES,
): Promise<TranscriptReadResult | null> {
  const sessionFiles = await findClaudeCodeSessionFiles(projectPath);

  if (sessionFiles.length === 0) {
    return null;
  }

  // If specific session ID provided, find matching file
  let targetFile: string | undefined;
  if (agentSessionId) {
    targetFile = sessionFiles.find((f) =>
      basename(f).includes(agentSessionId),
    );
  }

  // Fall back to most recent file
  const filePath = targetFile ?? sessionFiles[0];

  return readTranscriptFile(filePath, maxBytes);
}

// =============================================================================
// CODEX TRANSCRIPT
// =============================================================================

/**
 * Find Codex session files that match a workspace path.
 * Codex stores sessions in ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
 * with session_meta.cwd indicating the workspace.
 */
async function findCodexSessionFiles(workspacePath: string): Promise<string[]> {
  const codexSessionsDir = join(homedir(), ".codex", "sessions");

  if (!existsSync(codexSessionsDir)) {
    return [];
  }

  const matchingFiles: Array<{ path: string; mtime: number }> = [];

  try {
    // Walk YYYY/MM/DD structure
    const years = await readdir(codexSessionsDir);

    for (const year of years) {
      if (!/^\d{4}$/.test(year)) continue;
      const yearDir = join(codexSessionsDir, year);

      const months = await readdir(yearDir).catch(() => []);
      for (const month of months) {
        if (!/^\d{2}$/.test(month)) continue;
        const monthDir = join(yearDir, month);

        const days = await readdir(monthDir).catch(() => []);
        for (const day of days) {
          if (!/^\d{2}$/.test(day)) continue;
          const dayDir = join(monthDir, day);

          const files = await readdir(dayDir).catch(() => []);
          for (const file of files) {
            if (!file.startsWith("rollout-") || !file.endsWith(".jsonl")) continue;

            const filePath = join(dayDir, file);

            // Check if this session's cwd matches our workspace
            const cwdMatch = await checkCodexSessionCwd(filePath, workspacePath);
            if (cwdMatch) {
              const stats = await stat(filePath);
              matchingFiles.push({ path: filePath, mtime: stats.mtime.getTime() });
            }
          }
        }
      }
    }

    // Sort by mtime descending
    matchingFiles.sort((a, b) => b.mtime - a.mtime);
    return matchingFiles.map((f) => f.path);
  } catch {
    return [];
  }
}

/**
 * Check if a Codex session file's cwd matches the workspace path.
 * Reads only the first line (session_meta) to minimize I/O.
 */
async function checkCodexSessionCwd(
  filePath: string,
  workspacePath: string,
): Promise<boolean> {
  try {
    // Read just enough to get the first line
    const content = await readFile(filePath, { encoding: "utf-8" });
    const firstLine = content.split("\n")[0];
    if (!firstLine) return false;

    const entry = JSON.parse(firstLine) as Record<string, unknown>;
    if (entry.type !== "session_meta") return false;

    const cwd = entry.cwd as string | undefined;
    if (!cwd) return false;

    // Normalize paths for comparison
    return cwd.replace(/\/$/, "") === workspacePath.replace(/\/$/, "");
  } catch {
    return false;
  }
}

/**
 * Read Codex transcript for a session.
 * Finds the most recent session file that matches the workspace path.
 *
 * @param workspacePath - Path to the workspace directory
 * @param maxBytes - Maximum bytes to read (default: MAX_TRANSCRIPT_BYTES)
 */
export async function readCodexTranscript(
  workspacePath: string,
  maxBytes: number = MAX_TRANSCRIPT_BYTES,
): Promise<TranscriptReadResult | null> {
  const sessionFiles = await findCodexSessionFiles(workspacePath);

  if (sessionFiles.length === 0) {
    return null;
  }

  return readTranscriptFile(sessionFiles[0], maxBytes);
}

// =============================================================================
// SHARED UTILITIES
// =============================================================================

/**
 * Read and parse a JSONL transcript file.
 * Handles size limits and parsing errors gracefully.
 */
async function readTranscriptFile(
  filePath: string,
  maxBytes: number,
): Promise<TranscriptReadResult | null> {
  try {
    const stats = await stat(filePath);
    const originalSize = stats.size;
    const truncated = originalSize > maxBytes;

    // Read file content (potentially truncated)
    let content: string;
    if (truncated) {
      // Read last maxBytes (tail) to get most recent entries
      const { open } = await import("node:fs/promises");
      const fh = await open(filePath, "r");
      try {
        const buffer = Buffer.alloc(maxBytes);
        const startPos = Math.max(0, originalSize - maxBytes);
        await fh.read(buffer, 0, maxBytes, startPos);
        content = buffer.toString("utf-8");

        // If we truncated, skip the first (potentially partial) line
        const firstNewline = content.indexOf("\n");
        if (firstNewline !== -1 && startPos > 0) {
          content = content.slice(firstNewline + 1);
        }
      } finally {
        await fh.close();
      }
    } else {
      content = await readFile(filePath, "utf-8");
    }

    // Parse JSONL entries
    const entries: TranscriptEntry[] = [];
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const entry = JSON.parse(trimmed) as TranscriptEntry;
        entries.push(entry);
      } catch {
        // Skip malformed lines
      }
    }

    return {
      entries,
      filePath,
      truncated,
      originalSize,
    };
  } catch {
    return null;
  }
}

/**
 * Read transcript for any supported agent.
 * Automatically detects agent type and finds the appropriate transcript.
 *
 * @param agentName - Agent plugin name ("claude-code", "codex")
 * @param projectPath - Absolute path to the project
 * @param workspacePath - Path to the session's workspace
 * @param agentSessionId - Optional agent-specific session ID
 * @param maxBytes - Maximum bytes to read
 */
export async function readAgentTranscript(
  agentName: string,
  projectPath: string,
  workspacePath: string | null,
  agentSessionId?: string,
  maxBytes: number = MAX_TRANSCRIPT_BYTES,
): Promise<TranscriptReadResult | null> {
  switch (agentName) {
    case "claude-code":
      return readClaudeCodeTranscript(projectPath, agentSessionId, maxBytes);

    case "codex":
      if (!workspacePath) return null;
      return readCodexTranscript(workspacePath, maxBytes);

    default:
      // Unsupported agent
      return null;
  }
}

/**
 * Extract text content from transcript entries for LLM processing.
 * Filters to human/assistant messages and formats them for extraction prompt.
 */
export function formatTranscriptForExtraction(
  entries: TranscriptEntry[],
  maxLength: number = 100_000,
): string {
  const formatted: string[] = [];
  let totalLength = 0;

  for (const entry of entries) {
    if (totalLength >= maxLength) break;

    let line: string | null = null;

    if (entry.type === "user" || entry.type === "human") {
      const content = extractMessageContent(entry.message);
      if (content) {
        line = `USER: ${content}`;
      }
    } else if (entry.type === "assistant") {
      const content = extractMessageContent(entry.message);
      if (content) {
        line = `ASSISTANT: ${content}`;
      }
    } else if (entry.type === "tool_use" && entry.tool_use?.name) {
      line = `TOOL: ${entry.tool_use.name}`;
    } else if (entry.type === "tool_result" || entry.type === "result") {
      // Skip tool results to keep transcript focused
    }

    if (line) {
      const remaining = maxLength - totalLength;
      if (line.length > remaining) {
        line = line.slice(0, remaining) + "...";
      }
      formatted.push(line);
      totalLength += line.length + 1; // +1 for newline
    }
  }

  return formatted.join("\n");
}

/**
 * Extract text content from a message object.
 */
function extractMessageContent(
  message: TranscriptEntry["message"],
): string | null {
  if (!message) return null;

  if (typeof message.content === "string") {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    const textParts = message.content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n");
    return textParts || null;
  }

  return null;
}

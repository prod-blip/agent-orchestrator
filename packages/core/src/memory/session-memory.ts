/**
 * Session Memory — read/write operations for per-session memory files.
 *
 * Storage: {sessionId}.memory.json alongside session metadata in
 * ~/.agent-orchestrator/{hash}-{projectId}/sessions/
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SessionMemorySchema, MEMORY_VERSION } from "./types.js";
import type { SessionMemory, ExtractionOutput } from "./types.js";

/**
 * Get the path to a session's memory file.
 */
export function getSessionMemoryPath(sessionsDir: string, sessionId: string): string {
  return join(sessionsDir, `${sessionId}.memory.json`);
}

/**
 * Check if session memory exists.
 */
export function sessionMemoryExists(sessionsDir: string, sessionId: string): boolean {
  return existsSync(getSessionMemoryPath(sessionsDir, sessionId));
}

/**
 * Read session memory from disk.
 * Returns null if the file doesn't exist or is invalid.
 */
export async function readSessionMemory(
  sessionsDir: string,
  sessionId: string,
): Promise<SessionMemory | null> {
  const filePath = getSessionMemoryPath(sessionsDir, sessionId);

  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    const result = SessionMemorySchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    // Schema validation failed — file may be corrupted or from old version
    return null;
  } catch {
    // File doesn't exist or couldn't be read
    return null;
  }
}

/**
 * Write session memory to disk.
 * Validates the data before writing.
 */
export async function writeSessionMemory(
  sessionsDir: string,
  sessionId: string,
  memory: SessionMemory,
): Promise<void> {
  const filePath = getSessionMemoryPath(sessionsDir, sessionId);

  // Validate before writing
  const result = SessionMemorySchema.safeParse(memory);
  if (!result.success) {
    throw new Error(`Invalid session memory: ${result.error.message}`);
  }

  const content = JSON.stringify(result.data, null, 2);
  await writeFile(filePath, content, "utf-8");
}

/**
 * Create a SessionMemory object from extraction output.
 * Fills in defaults for missing fields.
 */
export function createSessionMemory(
  sessionId: string,
  status: string,
  extraction: ExtractionOutput,
): SessionMemory {
  const now = new Date().toISOString();

  // Normalize observations to include timestamps
  const observations = (extraction.observations ?? []).map((obs) => ({
    content: obs.content,
    ts: obs.ts ?? now,
  }));

  return {
    sessionId,
    task: extraction.task ?? "Unknown task",
    status,
    facts: extraction.facts ?? [],
    entities: extraction.entities ?? {},
    observations,
    updatedAt: now,
    completedAt: now,
    version: MEMORY_VERSION,
  };
}

/**
 * List all session memory files in a sessions directory.
 * Returns session IDs that have memory files.
 */
export async function listSessionMemories(sessionsDir: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");

  try {
    const files = await readdir(sessionsDir);
    return files
      .filter((f) => f.endsWith(".memory.json"))
      .map((f) => f.replace(".memory.json", ""));
  } catch {
    return [];
  }
}

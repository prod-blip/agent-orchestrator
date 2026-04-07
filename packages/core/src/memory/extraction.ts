/**
 * Memory Extraction — spawns agent to extract memory from transcripts.
 *
 * Extraction flow:
 * 1. Read transcript from agent's JSONL
 * 2. Build extraction prompt with transcript + session info
 * 3. Spawn quick extraction session (claude -p "<prompt>" --dangerously-skip-permissions)
 * 4. Parse JSON output from agent
 * 5. Validate against schema and create SessionMemory
 */

import { spawn } from "node:child_process";
import { ExtractionOutputSchema, EXTRACTION_TIMEOUT_MS } from "./types.js";
import type { ExtractionOutput, SessionMemory } from "./types.js";
import {
  readAgentTranscript,
  formatTranscriptForExtraction,
} from "./transcript-reader.js";
import { buildExtractionPrompt } from "./prompt.js";
import { createSessionMemory } from "./session-memory.js";

// =============================================================================
// TYPES
// =============================================================================

export interface ExtractionConfig {
  /** Agent name (e.g., "claude-code", "codex") */
  agentName: string;
  /** Session ID */
  sessionId: string;
  /** Final session status */
  status: string;
  /** Project name for context */
  projectName: string;
  /** Absolute path to the project */
  projectPath: string;
  /** Path to the session's workspace (may be null for some agents) */
  workspacePath: string | null;
  /** Agent's internal session ID (for finding specific transcript) */
  agentSessionId?: string;
  /** Extraction timeout in ms (default: EXTRACTION_TIMEOUT_MS) */
  timeoutMs?: number;
}

export interface ExtractionResult {
  /** Whether extraction succeeded */
  success: boolean;
  /** Extracted session memory (if successful) */
  memory?: SessionMemory;
  /** Error message (if failed) */
  error?: string;
  /** Path to transcript that was analyzed */
  transcriptPath?: string;
}

// =============================================================================
// EXTRACTION
// =============================================================================

/**
 * Run extraction and return SessionMemory.
 * This is the main entry point for memory extraction.
 */
export async function extractMemory(
  config: ExtractionConfig,
): Promise<ExtractionResult> {
  const {
    agentName,
    sessionId,
    status,
    projectName,
    projectPath,
    workspacePath,
    agentSessionId,
    timeoutMs = EXTRACTION_TIMEOUT_MS,
  } = config;

  // 1. Read transcript
  const transcriptResult = await readAgentTranscript(
    agentName,
    projectPath,
    workspacePath,
    agentSessionId,
  );

  if (!transcriptResult || transcriptResult.entries.length === 0) {
    return {
      success: false,
      error: "No transcript found or transcript is empty",
    };
  }

  // 2. Format transcript for extraction
  const formattedTranscript = formatTranscriptForExtraction(
    transcriptResult.entries,
  );

  if (formattedTranscript.length < 50) {
    return {
      success: false,
      error: "Transcript too short for meaningful extraction",
      transcriptPath: transcriptResult.filePath,
    };
  }

  // 3. Build extraction prompt
  const extractionPrompt = buildExtractionPrompt(
    projectName,
    sessionId,
    status,
    formattedTranscript,
  );

  // 4. Spawn extraction agent
  let rawOutput: string;
  try {
    rawOutput = await spawnExtractionAgent(extractionPrompt, timeoutMs);
  } catch (err) {
    return {
      success: false,
      error: `Extraction agent failed: ${err instanceof Error ? err.message : String(err)}`,
      transcriptPath: transcriptResult.filePath,
    };
  }

  // 5. Parse and validate output
  const extraction = parseExtractionOutput(rawOutput);
  if (!extraction) {
    return {
      success: false,
      error: "Failed to parse extraction output as JSON",
      transcriptPath: transcriptResult.filePath,
    };
  }

  // 6. Create SessionMemory
  const memory = createSessionMemory(sessionId, status, extraction);

  return {
    success: true,
    memory,
    transcriptPath: transcriptResult.filePath,
  };
}

/**
 * Spawn Claude CLI to run extraction.
 * Uses --dangerously-skip-permissions for non-interactive extraction.
 */
async function spawnExtractionAgent(
  prompt: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Use claude CLI with -p flag for one-shot prompt
    const proc = spawn("claude", ["-p", prompt, "--dangerously-skip-permissions"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Extraction timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Claude exited with code ${code}: ${stderr || stdout}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

/**
 * Parse extraction output from agent.
 * Handles various JSON wrapper formats the agent might use.
 */
function parseExtractionOutput(output: string): ExtractionOutput | null {
  // Try direct JSON parse first
  const trimmed = output.trim();

  // Try to extract JSON from markdown code blocks
  const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : trimmed;

  try {
    const parsed = JSON.parse(jsonStr);
    const result = ExtractionOutputSchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    // Try to extract what we can even if schema doesn't fully match
    if (typeof parsed === "object" && parsed !== null) {
      const obj = parsed as Record<string, unknown>;
      const extractedEntities: Record<string, string> | undefined =
        typeof obj.entities === "object" && obj.entities !== null
          ? Object.fromEntries(
              Object.entries(obj.entities as Record<string, unknown>).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string",
              ),
            )
          : undefined;

      return {
        task: typeof obj.task === "string" ? obj.task : undefined,
        facts: Array.isArray(obj.facts)
          ? obj.facts.filter((f): f is string => typeof f === "string")
          : undefined,
        entities: extractedEntities,
        observations: Array.isArray(obj.observations)
          ? obj.observations
              .map((o: unknown) => {
                if (typeof o === "string") return { content: o };
                if (typeof o === "object" && o !== null && "content" in o) {
                  return { content: String((o as Record<string, unknown>).content) };
                }
                return null;
              })
              .filter((o): o is { content: string } => o !== null)
          : undefined,
      };
    }

    return null;
  } catch {
    // JSON parse failed — try to find JSON object in output
    const objectMatch = output.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const parsed = JSON.parse(objectMatch[0]);
        return parseExtractionOutput(JSON.stringify(parsed));
      } catch {
        return null;
      }
    }

    return null;
  }
}

/**
 * Check if extraction is available for an agent.
 * Returns true if the agent type is supported and claude CLI is available.
 */
export async function isExtractionAvailable(agentName: string): Promise<boolean> {
  // Check if agent type is supported
  if (agentName !== "claude-code" && agentName !== "codex") {
    return false;
  }

  // Check if claude CLI is available
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], {
      stdio: "ignore",
    });

    proc.on("close", (code) => {
      resolve(code === 0);
    });

    proc.on("error", () => {
      resolve(false);
    });
  });
}

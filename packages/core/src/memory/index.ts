/**
 * Memory System — public exports.
 *
 * Three-layer memory architecture:
 * 1. Raw Session History — transcripts from agents (already exists)
 * 2. Session Memory — per-session structured JSON extracted by AO at session end
 * 3. Project Memory — aggregated knowledge injected into new sessions
 */

// Types and schemas
export {
  SessionMemorySchema,
  ProjectMemorySchema,
  ObservationSchema,
  ExtractionOutputSchema,
  MEMORY_VERSION,
  MAX_PROJECT_OBSERVATIONS,
  MAX_TRANSCRIPT_BYTES,
  EXTRACTION_TIMEOUT_MS,
  MEMORY_TRIGGER_STATUSES,
  MEMORY_SKIP_STATUSES,
} from "./types.js";

export type {
  SessionMemory,
  ProjectMemory,
  Observation,
  ExtractionOutput,
} from "./types.js";

// Session memory operations
export {
  getSessionMemoryPath,
  sessionMemoryExists,
  readSessionMemory,
  writeSessionMemory,
  createSessionMemory,
  listSessionMemories,
} from "./session-memory.js";

// Project memory operations
export {
  getProjectMemoryPath,
  projectMemoryExists,
  readProjectMemory,
  writeProjectMemory,
  createEmptyProjectMemory,
  consolidateMemory,
  consolidateAndWriteProjectMemory,
  formatProjectMemoryForPrompt,
} from "./project-memory.js";

// Transcript reading
export {
  readClaudeCodeTranscript,
  readCodexTranscript,
  readAgentTranscript,
  formatTranscriptForExtraction,
} from "./transcript-reader.js";

export type { TranscriptEntry, TranscriptReadResult } from "./transcript-reader.js";

// Prompt building
export { buildExtractionPrompt, buildMinimalExtractionPrompt } from "./prompt.js";

// Extraction
export { extractMemory, isExtractionAvailable } from "./extraction.js";

export type { ExtractionConfig, ExtractionResult } from "./extraction.js";

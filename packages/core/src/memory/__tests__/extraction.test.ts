import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

// Mock child_process before importing extraction module
vi.mock("node:child_process", () => ({
  spawn: vi.fn(),
}));

// Mock transcript reader
vi.mock("../transcript-reader.js", () => ({
  readAgentTranscript: vi.fn(),
  formatTranscriptForExtraction: vi.fn(),
}));

import { spawn } from "node:child_process";
import { extractMemory, isExtractionAvailable } from "../extraction.js";
import {
  readAgentTranscript,
  formatTranscriptForExtraction,
} from "../transcript-reader.js";

// Helper to create mock child process
function createMockProcess(
  stdout: string,
  stderr: string,
  exitCode: number,
): ChildProcess {
  const proc = new EventEmitter() as ChildProcess;
  const stdoutEmitter = new EventEmitter();
  const stderrEmitter = new EventEmitter();

  // Cast to any to bypass strict type checking for test mocks
  (proc as any).stdout = stdoutEmitter;
  (proc as any).stderr = stderrEmitter;
  (proc as any).kill = vi.fn();

  // Simulate async output
  setTimeout(() => {
    stdoutEmitter.emit("data", Buffer.from(stdout));
    stderrEmitter.emit("data", Buffer.from(stderr));
    proc.emit("close", exitCode);
  }, 10);

  return proc;
}

describe("Memory Extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("extractMemory", () => {
    const baseConfig = {
      agentName: "claude-code",
      sessionId: "test-1",
      status: "merged",
      projectName: "Test Project",
      projectPath: "/project",
      workspacePath: "/workspace",
    };

    it("returns error when no transcript found", async () => {
      vi.mocked(readAgentTranscript).mockResolvedValue(null);

      const result = await extractMemory(baseConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain("No transcript found");
    });

    it("returns error when transcript is empty", async () => {
      vi.mocked(readAgentTranscript).mockResolvedValue({
        entries: [],
        filePath: "/path/to/transcript.jsonl",
        truncated: false,
        originalSize: 0,
      });

      const result = await extractMemory(baseConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain("No transcript found");
    });

    it("returns error when transcript is too short", async () => {
      vi.mocked(readAgentTranscript).mockResolvedValue({
        entries: [{ type: "user", message: { content: "hi" } }],
        filePath: "/path/to/transcript.jsonl",
        truncated: false,
        originalSize: 10,
      });
      vi.mocked(formatTranscriptForExtraction).mockReturnValue("hi");

      const result = await extractMemory(baseConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain("too short");
      expect(result.transcriptPath).toBe("/path/to/transcript.jsonl");
    });

    it("extracts memory successfully with valid JSON output", async () => {
      vi.mocked(readAgentTranscript).mockResolvedValue({
        entries: [{ type: "user", message: { content: "Fix the login bug" } }],
        filePath: "/path/to/transcript.jsonl",
        truncated: false,
        originalSize: 1000,
      });
      vi.mocked(formatTranscriptForExtraction).mockReturnValue(
        "USER: Fix the login bug\n" + "A".repeat(100),
      );

      const mockOutput = JSON.stringify({
        task: "Fixed login bug",
        facts: ["Uses JWT for auth"],
        entities: { "auth file": "src/auth.ts" },
        observations: [{ content: "Tests needed retry" }],
      });

      vi.mocked(spawn).mockReturnValue(createMockProcess(mockOutput, "", 0));

      const result = await extractMemory(baseConfig);

      expect(result.success).toBe(true);
      expect(result.memory).toBeDefined();
      expect(result.memory?.task).toBe("Fixed login bug");
      expect(result.memory?.facts).toContain("Uses JWT for auth");
      expect(result.memory?.entities["auth file"]).toBe("src/auth.ts");
      expect(result.transcriptPath).toBe("/path/to/transcript.jsonl");
    });

    it("handles JSON wrapped in markdown code blocks", async () => {
      vi.mocked(readAgentTranscript).mockResolvedValue({
        entries: [{ type: "user", message: { content: "Fix bug" } }],
        filePath: "/transcript.jsonl",
        truncated: false,
        originalSize: 1000,
      });
      vi.mocked(formatTranscriptForExtraction).mockReturnValue("USER: " + "A".repeat(100));

      const mockOutput = "```json\n" + JSON.stringify({ task: "Fixed it" }) + "\n```";

      vi.mocked(spawn).mockReturnValue(createMockProcess(mockOutput, "", 0));

      const result = await extractMemory(baseConfig);

      expect(result.success).toBe(true);
      expect(result.memory?.task).toBe("Fixed it");
    });

    it("returns error when agent exits with non-zero code", async () => {
      vi.mocked(readAgentTranscript).mockResolvedValue({
        entries: [{ type: "user", message: { content: "Fix bug" } }],
        filePath: "/transcript.jsonl",
        truncated: false,
        originalSize: 1000,
      });
      vi.mocked(formatTranscriptForExtraction).mockReturnValue("USER: " + "A".repeat(100));

      vi.mocked(spawn).mockReturnValue(createMockProcess("", "Error occurred", 1));

      const result = await extractMemory(baseConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Extraction agent failed");
    });

    it("returns error when JSON parsing fails", async () => {
      vi.mocked(readAgentTranscript).mockResolvedValue({
        entries: [{ type: "user", message: { content: "Fix bug" } }],
        filePath: "/transcript.jsonl",
        truncated: false,
        originalSize: 1000,
      });
      vi.mocked(formatTranscriptForExtraction).mockReturnValue("USER: " + "A".repeat(100));

      vi.mocked(spawn).mockReturnValue(createMockProcess("not valid json at all", "", 0));

      const result = await extractMemory(baseConfig);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to parse");
    });

    it("handles partial JSON gracefully", async () => {
      vi.mocked(readAgentTranscript).mockResolvedValue({
        entries: [{ type: "user", message: { content: "Fix bug" } }],
        filePath: "/transcript.jsonl",
        truncated: false,
        originalSize: 1000,
      });
      vi.mocked(formatTranscriptForExtraction).mockReturnValue("USER: " + "A".repeat(100));

      // JSON with only task field
      const mockOutput = JSON.stringify({ task: "Partial extraction" });

      vi.mocked(spawn).mockReturnValue(createMockProcess(mockOutput, "", 0));

      const result = await extractMemory(baseConfig);

      expect(result.success).toBe(true);
      expect(result.memory?.task).toBe("Partial extraction");
      expect(result.memory?.facts).toEqual([]);
    });
  });

  describe("isExtractionAvailable", () => {
    it("returns false for unsupported agent", async () => {
      const result = await isExtractionAvailable("unsupported");
      expect(result).toBe(false);
    });

    it("returns true for claude-code when CLI available", async () => {
      vi.mocked(spawn).mockImplementation(() => createMockProcess("claude 1.0.0", "", 0));

      const result = await isExtractionAvailable("claude-code");
      expect(result).toBe(true);
    });

    it("returns false when claude CLI not found", async () => {
      vi.mocked(spawn).mockImplementation(() => {
        const proc = new EventEmitter() as ChildProcess;
        (proc as any).stdout = new EventEmitter();
        (proc as any).stderr = new EventEmitter();
        setTimeout(() => proc.emit("error", new Error("ENOENT")), 10);
        return proc;
      });

      const result = await isExtractionAvailable("claude-code");
      expect(result).toBe(false);
    });
  });
});

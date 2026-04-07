import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import {
  readClaudeCodeTranscript,
  readCodexTranscript,
  readAgentTranscript,
  formatTranscriptForExtraction,
} from "../transcript-reader.js";
import type { TranscriptEntry } from "../transcript-reader.js";

describe("Transcript Reader", () => {
  let testDir: string;
  let claudeProjectsDir: string;
  let codexSessionsDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `ao-transcript-test-${Date.now()}`);
    // Create mock Claude and Codex directories under test dir
    claudeProjectsDir = join(testDir, ".claude", "projects");
    codexSessionsDir = join(testDir, ".codex", "sessions");
    await mkdir(claudeProjectsDir, { recursive: true });
    await mkdir(codexSessionsDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe("formatTranscriptForExtraction", () => {
    it("formats user messages", () => {
      const entries: TranscriptEntry[] = [
        { type: "user", message: { role: "user", content: "Hello" } },
      ];
      const result = formatTranscriptForExtraction(entries);
      expect(result).toBe("USER: Hello");
    });

    it("formats assistant messages", () => {
      const entries: TranscriptEntry[] = [
        { type: "assistant", message: { role: "assistant", content: "Hi there" } },
      ];
      const result = formatTranscriptForExtraction(entries);
      expect(result).toBe("ASSISTANT: Hi there");
    });

    it("formats tool use entries", () => {
      const entries: TranscriptEntry[] = [
        { type: "tool_use", tool_use: { name: "read_file", input: { path: "/test" } } },
      ];
      const result = formatTranscriptForExtraction(entries);
      expect(result).toBe("TOOL: read_file");
    });

    it("handles array content format", () => {
      const entries: TranscriptEntry[] = [
        {
          type: "user",
          message: {
            content: [
              { type: "text", text: "Part 1" },
              { type: "text", text: "Part 2" },
            ],
          },
        },
      ];
      const result = formatTranscriptForExtraction(entries);
      expect(result).toContain("Part 1");
      expect(result).toContain("Part 2");
    });

    it("respects maxLength limit", () => {
      const entries: TranscriptEntry[] = [
        { type: "user", message: { content: "A".repeat(1000) } },
        { type: "assistant", message: { content: "B".repeat(1000) } },
      ];
      const result = formatTranscriptForExtraction(entries, 500);
      expect(result.length).toBeLessThanOrEqual(503); // 500 + "..."
    });

    it("skips tool results", () => {
      const entries: TranscriptEntry[] = [
        { type: "tool_result", result: "some result" },
        { type: "result", result: "another result" },
        { type: "user", message: { content: "Hello" } },
      ];
      const result = formatTranscriptForExtraction(entries);
      expect(result).toBe("USER: Hello");
      expect(result).not.toContain("some result");
    });

    it("handles empty entries", () => {
      const entries: TranscriptEntry[] = [];
      const result = formatTranscriptForExtraction(entries);
      expect(result).toBe("");
    });

    it("skips entries with missing content", () => {
      const entries: TranscriptEntry[] = [
        { type: "user", message: {} },
        { type: "assistant" },
        { type: "user", message: { content: "Valid" } },
      ];
      const result = formatTranscriptForExtraction(entries);
      expect(result).toBe("USER: Valid");
    });
  });

  describe("readAgentTranscript", () => {
    it("returns null for unsupported agent", async () => {
      const result = await readAgentTranscript(
        "unsupported-agent",
        "/project",
        "/workspace",
      );
      expect(result).toBeNull();
    });

    it("returns null for codex without workspace path", async () => {
      const result = await readAgentTranscript("codex", "/project", null);
      expect(result).toBeNull();
    });
  });

  // Note: Full integration tests for readClaudeCodeTranscript and readCodexTranscript
  // require mocking the home directory or creating files in ~/.claude and ~/.codex,
  // which is invasive. These are tested via the readAgentTranscript wrapper above
  // and manual testing.

  describe("readClaudeCodeTranscript (unit behavior)", () => {
    it("returns null when no session files exist", async () => {
      // Using a path that won't have Claude projects
      const result = await readClaudeCodeTranscript("/nonexistent/project");
      expect(result).toBeNull();
    });
  });

  describe("readCodexTranscript (unit behavior)", () => {
    it("returns null when no matching session files exist", async () => {
      const result = await readCodexTranscript("/nonexistent/workspace");
      expect(result).toBeNull();
    });
  });
});

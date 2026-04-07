import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getSessionMemoryPath,
  sessionMemoryExists,
  readSessionMemory,
  writeSessionMemory,
  createSessionMemory,
  listSessionMemories,
} from "../session-memory.js";
import type { SessionMemory, ExtractionOutput } from "../types.js";

describe("Session Memory", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `ao-session-memory-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe("getSessionMemoryPath", () => {
    it("returns correct path for session", () => {
      const path = getSessionMemoryPath("/sessions", "test-1");
      expect(path).toBe("/sessions/test-1.memory.json");
    });
  });

  describe("sessionMemoryExists", () => {
    it("returns false when file does not exist", () => {
      expect(sessionMemoryExists(testDir, "nonexistent")).toBe(false);
    });

    it("returns true when file exists", async () => {
      await writeFile(join(testDir, "test-1.memory.json"), "{}");
      expect(sessionMemoryExists(testDir, "test-1")).toBe(true);
    });
  });

  describe("readSessionMemory", () => {
    it("returns null for nonexistent file", async () => {
      const result = await readSessionMemory(testDir, "nonexistent");
      expect(result).toBeNull();
    });

    it("returns null for invalid JSON", async () => {
      await writeFile(join(testDir, "invalid.memory.json"), "not json");
      const result = await readSessionMemory(testDir, "invalid");
      expect(result).toBeNull();
    });

    it("returns null for invalid schema", async () => {
      await writeFile(
        join(testDir, "bad-schema.memory.json"),
        JSON.stringify({ foo: "bar" }),
      );
      const result = await readSessionMemory(testDir, "bad-schema");
      expect(result).toBeNull();
    });

    it("reads valid session memory", async () => {
      const memory: SessionMemory = {
        sessionId: "test-1",
        task: "Fix bug",
        status: "merged",
        facts: ["Uses TypeScript"],
        entities: { "main entry": "src/index.ts" },
        observations: [{ content: "Tests pass", ts: "2024-01-01T00:00:00Z" }],
        updatedAt: "2024-01-01T00:00:00Z",
        completedAt: "2024-01-01T00:00:00Z",
        version: 1,
      };
      await writeFile(join(testDir, "test-1.memory.json"), JSON.stringify(memory));

      const result = await readSessionMemory(testDir, "test-1");
      expect(result).toEqual(memory);
    });
  });

  describe("writeSessionMemory", () => {
    it("writes valid session memory", async () => {
      const memory: SessionMemory = {
        sessionId: "test-1",
        task: "Fix bug",
        status: "merged",
        facts: ["Uses TypeScript"],
        entities: {},
        observations: [],
        updatedAt: "2024-01-01T00:00:00Z",
        completedAt: "2024-01-01T00:00:00Z",
        version: 1,
      };

      await writeSessionMemory(testDir, "test-1", memory);

      const content = await readFile(join(testDir, "test-1.memory.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(memory);
    });

    it("throws on invalid memory", async () => {
      const invalid = { foo: "bar" } as unknown as SessionMemory;
      await expect(writeSessionMemory(testDir, "test-1", invalid)).rejects.toThrow(
        "Invalid session memory",
      );
    });

    it("formats JSON with indentation", async () => {
      const memory: SessionMemory = {
        sessionId: "test-1",
        task: "Fix",
        status: "done",
        facts: [],
        entities: {},
        observations: [],
        updatedAt: "2024-01-01T00:00:00Z",
        completedAt: "2024-01-01T00:00:00Z",
        version: 1,
      };

      await writeSessionMemory(testDir, "test-1", memory);

      const content = await readFile(join(testDir, "test-1.memory.json"), "utf-8");
      expect(content).toContain("\n"); // Should be formatted
    });
  });

  describe("createSessionMemory", () => {
    it("creates memory from extraction output", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));

      const extraction: ExtractionOutput = {
        task: "Implement feature",
        facts: ["Fact 1", "Fact 2"],
        entities: { key: "value" },
        observations: [{ content: "Observation 1" }],
      };

      const memory = createSessionMemory("test-1", "merged", extraction);

      expect(memory.sessionId).toBe("test-1");
      expect(memory.task).toBe("Implement feature");
      expect(memory.status).toBe("merged");
      expect(memory.facts).toEqual(["Fact 1", "Fact 2"]);
      expect(memory.entities).toEqual({ key: "value" });
      expect(memory.observations).toHaveLength(1);
      expect(memory.observations[0].content).toBe("Observation 1");
      expect(memory.observations[0].ts).toBe("2024-06-15T12:00:00.000Z");
      expect(memory.version).toBe(1);

      vi.useRealTimers();
    });

    it("uses defaults for missing fields", () => {
      const extraction: ExtractionOutput = {};
      const memory = createSessionMemory("test-1", "done", extraction);

      expect(memory.task).toBe("Unknown task");
      expect(memory.facts).toEqual([]);
      expect(memory.entities).toEqual({});
      expect(memory.observations).toEqual([]);
    });

    it("preserves observation timestamps when provided", () => {
      const extraction: ExtractionOutput = {
        observations: [{ content: "Obs", ts: "2024-01-01T00:00:00Z" }],
      };
      const memory = createSessionMemory("test-1", "done", extraction);

      expect(memory.observations[0].ts).toBe("2024-01-01T00:00:00Z");
    });
  });

  describe("listSessionMemories", () => {
    it("returns empty array for empty directory", async () => {
      const result = await listSessionMemories(testDir);
      expect(result).toEqual([]);
    });

    it("returns empty array for nonexistent directory", async () => {
      const result = await listSessionMemories("/nonexistent/path");
      expect(result).toEqual([]);
    });

    it("lists session IDs with memory files", async () => {
      await writeFile(join(testDir, "test-1.memory.json"), "{}");
      await writeFile(join(testDir, "test-2.memory.json"), "{}");
      await writeFile(join(testDir, "test-3"), "not a memory file");
      await writeFile(join(testDir, "other.json"), "{}");

      const result = await listSessionMemories(testDir);
      expect(result).toHaveLength(2);
      expect(result).toContain("test-1");
      expect(result).toContain("test-2");
    });
  });
});

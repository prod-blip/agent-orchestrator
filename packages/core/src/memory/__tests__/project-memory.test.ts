import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getProjectMemoryPath,
  projectMemoryExists,
  readProjectMemory,
  writeProjectMemory,
  createEmptyProjectMemory,
  consolidateMemory,
  consolidateAndWriteProjectMemory,
  formatProjectMemoryForPrompt,
} from "../project-memory.js";
import type { ProjectMemory, SessionMemory } from "../types.js";

describe("Project Memory", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `ao-project-memory-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe("getProjectMemoryPath", () => {
    it("returns correct path", () => {
      const path = getProjectMemoryPath("/project");
      expect(path).toBe("/project/project-memory.json");
    });
  });

  describe("projectMemoryExists", () => {
    it("returns false when file does not exist", () => {
      expect(projectMemoryExists(testDir)).toBe(false);
    });

    it("returns true when file exists", async () => {
      await writeFile(join(testDir, "project-memory.json"), "{}");
      expect(projectMemoryExists(testDir)).toBe(true);
    });
  });

  describe("readProjectMemory", () => {
    it("returns null for nonexistent file", async () => {
      const result = await readProjectMemory(testDir);
      expect(result).toBeNull();
    });

    it("returns null for invalid JSON", async () => {
      await writeFile(join(testDir, "project-memory.json"), "not json");
      const result = await readProjectMemory(testDir);
      expect(result).toBeNull();
    });

    it("reads valid project memory", async () => {
      const memory: ProjectMemory = {
        facts: ["Fact 1"],
        entities: { key: "value" },
        observations: [{ content: "Obs", ts: "2024-01-01T00:00:00Z" }],
        updatedAt: "2024-01-01T00:00:00Z",
        sessionCount: 3,
        version: 1,
      };
      await writeFile(join(testDir, "project-memory.json"), JSON.stringify(memory));

      const result = await readProjectMemory(testDir);
      expect(result).toEqual(memory);
    });
  });

  describe("writeProjectMemory", () => {
    it("writes valid project memory", async () => {
      const memory: ProjectMemory = {
        facts: ["Fact 1"],
        entities: {},
        observations: [],
        updatedAt: "2024-01-01T00:00:00Z",
        sessionCount: 1,
        version: 1,
      };

      await writeProjectMemory(testDir, memory);

      const content = await readFile(join(testDir, "project-memory.json"), "utf-8");
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(memory);
    });

    it("throws on invalid memory", async () => {
      const invalid = { foo: "bar" } as unknown as ProjectMemory;
      await expect(writeProjectMemory(testDir, invalid)).rejects.toThrow(
        "Invalid project memory",
      );
    });
  });

  describe("createEmptyProjectMemory", () => {
    it("creates empty memory with defaults", () => {
      const memory = createEmptyProjectMemory();

      expect(memory.facts).toEqual([]);
      expect(memory.entities).toEqual({});
      expect(memory.observations).toEqual([]);
      expect(memory.sessionCount).toBe(0);
      expect(memory.version).toBe(1);
      expect(memory.updatedAt).toBeDefined();
    });
  });

  describe("consolidateMemory", () => {
    const baseProjectMemory: ProjectMemory = {
      facts: ["Existing fact"],
      entities: { existingKey: "existingValue" },
      observations: [{ content: "Old obs", ts: "2024-01-01T00:00:00Z" }],
      updatedAt: "2024-01-01T00:00:00Z",
      sessionCount: 2,
      version: 1,
    };

    const baseSessionMemory: SessionMemory = {
      sessionId: "test-1",
      task: "Fix bug",
      status: "merged",
      facts: ["New fact"],
      entities: { newKey: "newValue" },
      observations: [{ content: "New obs", ts: "2024-06-01T00:00:00Z" }],
      updatedAt: "2024-06-01T00:00:00Z",
      completedAt: "2024-06-01T00:00:00Z",
      version: 1,
    };

    it("adds new facts", () => {
      const result = consolidateMemory(baseProjectMemory, baseSessionMemory);
      expect(result.facts).toContain("Existing fact");
      expect(result.facts).toContain("New fact");
    });

    it("skips duplicate facts (case-insensitive)", () => {
      const sessionWithDupe: SessionMemory = {
        ...baseSessionMemory,
        facts: ["EXISTING FACT", "New unique fact"],
      };

      const result = consolidateMemory(baseProjectMemory, sessionWithDupe);
      expect(result.facts.filter((f) => f.toLowerCase() === "existing fact")).toHaveLength(1);
      expect(result.facts).toContain("New unique fact");
    });

    it("merges entities with newer values winning", () => {
      const sessionWithOverlap: SessionMemory = {
        ...baseSessionMemory,
        entities: { existingKey: "updatedValue", newKey: "newValue" },
      };

      const result = consolidateMemory(baseProjectMemory, sessionWithOverlap);
      expect(result.entities.existingKey).toBe("updatedValue");
      expect(result.entities.newKey).toBe("newValue");
    });

    it("merges observations sorted by timestamp (most recent first)", () => {
      const result = consolidateMemory(baseProjectMemory, baseSessionMemory);

      expect(result.observations).toHaveLength(2);
      // Most recent first
      expect(result.observations[0].content).toBe("New obs");
      expect(result.observations[1].content).toBe("Old obs");
    });

    it("caps observations at MAX_PROJECT_OBSERVATIONS", () => {
      const manyObs = Array.from({ length: 25 }, (_, i) => ({
        content: `Obs ${i}`,
        ts: new Date(2024, 0, i + 1).toISOString(),
      }));

      const projectWithMany: ProjectMemory = {
        ...baseProjectMemory,
        observations: manyObs.slice(0, 15),
      };

      const sessionWithMany: SessionMemory = {
        ...baseSessionMemory,
        observations: manyObs.slice(15),
      };

      const result = consolidateMemory(projectWithMany, sessionWithMany);
      expect(result.observations).toHaveLength(20);
    });

    it("increments session count", () => {
      const result = consolidateMemory(baseProjectMemory, baseSessionMemory);
      expect(result.sessionCount).toBe(3);
    });

    it("updates timestamp", () => {
      const result = consolidateMemory(baseProjectMemory, baseSessionMemory);
      expect(result.updatedAt).not.toBe(baseProjectMemory.updatedAt);
    });
  });

  describe("consolidateAndWriteProjectMemory", () => {
    it("creates new project memory if none exists", async () => {
      const sessionMemory: SessionMemory = {
        sessionId: "test-1",
        task: "Fix bug",
        status: "merged",
        facts: ["New fact"],
        entities: { key: "value" },
        observations: [],
        updatedAt: "2024-01-01T00:00:00Z",
        completedAt: "2024-01-01T00:00:00Z",
        version: 1,
      };

      const result = await consolidateAndWriteProjectMemory(testDir, sessionMemory);

      expect(result.sessionCount).toBe(1);
      expect(result.facts).toContain("New fact");
      expect(projectMemoryExists(testDir)).toBe(true);
    });

    it("consolidates with existing project memory", async () => {
      const existing: ProjectMemory = {
        facts: ["Existing"],
        entities: {},
        observations: [],
        updatedAt: "2024-01-01T00:00:00Z",
        sessionCount: 5,
        version: 1,
      };
      await writeFile(join(testDir, "project-memory.json"), JSON.stringify(existing));

      const sessionMemory: SessionMemory = {
        sessionId: "test-1",
        task: "Fix bug",
        status: "merged",
        facts: ["New"],
        entities: {},
        observations: [],
        updatedAt: "2024-06-01T00:00:00Z",
        completedAt: "2024-06-01T00:00:00Z",
        version: 1,
      };

      const result = await consolidateAndWriteProjectMemory(testDir, sessionMemory);

      expect(result.sessionCount).toBe(6);
      expect(result.facts).toContain("Existing");
      expect(result.facts).toContain("New");
    });
  });

  describe("formatProjectMemoryForPrompt", () => {
    it("returns empty string for empty memory", () => {
      const memory = createEmptyProjectMemory();
      const result = formatProjectMemoryForPrompt(memory);
      expect(result).toBe("");
    });

    it("includes facts section", () => {
      const memory: ProjectMemory = {
        facts: ["Fact 1", "Fact 2"],
        entities: {},
        observations: [],
        updatedAt: "2024-01-01T00:00:00Z",
        sessionCount: 1,
        version: 1,
      };

      const result = formatProjectMemoryForPrompt(memory);
      expect(result).toContain("### Project Knowledge");
      expect(result).toContain("- Fact 1");
      expect(result).toContain("- Fact 2");
    });

    it("includes entities section", () => {
      const memory: ProjectMemory = {
        facts: [],
        entities: { "test command": "pnpm test", "main entry": "src/index.ts" },
        observations: [],
        updatedAt: "2024-01-01T00:00:00Z",
        sessionCount: 1,
        version: 1,
      };

      const result = formatProjectMemoryForPrompt(memory);
      expect(result).toContain("### Key References");
      expect(result).toContain("**test command**: pnpm test");
      expect(result).toContain("**main entry**: src/index.ts");
    });

    it("includes recent observations (max 5)", () => {
      const observations = Array.from({ length: 10 }, (_, i) => ({
        content: `Observation ${i}`,
        ts: new Date(2024, 0, i + 1).toISOString(),
      }));

      const memory: ProjectMemory = {
        facts: [],
        entities: {},
        observations,
        updatedAt: "2024-01-01T00:00:00Z",
        sessionCount: 1,
        version: 1,
      };

      const result = formatProjectMemoryForPrompt(memory);
      expect(result).toContain("### Recent Observations");
      // Should only include first 5
      expect((result.match(/- Observation/g) || []).length).toBe(5);
    });

    it("includes session count in header", () => {
      const memory: ProjectMemory = {
        facts: ["Fact"],
        entities: {},
        observations: [],
        updatedAt: "2024-01-01T00:00:00Z",
        sessionCount: 42,
        version: 1,
      };

      const result = formatProjectMemoryForPrompt(memory);
      expect(result).toContain("42 previous sessions");
    });
  });
});

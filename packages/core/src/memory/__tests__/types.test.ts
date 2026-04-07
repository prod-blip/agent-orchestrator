import { describe, it, expect } from "vitest";
import {
  SessionMemorySchema,
  ProjectMemorySchema,
  ObservationSchema,
  ExtractionOutputSchema,
  MEMORY_VERSION,
  MAX_PROJECT_OBSERVATIONS,
  MEMORY_TRIGGER_STATUSES,
  MEMORY_SKIP_STATUSES,
} from "../types.js";

describe("Memory Types", () => {
  describe("ObservationSchema", () => {
    it("validates valid observation", () => {
      const obs = { content: "Test observation", ts: "2024-01-01T00:00:00Z" };
      const result = ObservationSchema.safeParse(obs);
      expect(result.success).toBe(true);
    });

    it("rejects missing content", () => {
      const obs = { ts: "2024-01-01T00:00:00Z" };
      const result = ObservationSchema.safeParse(obs);
      expect(result.success).toBe(false);
    });

    it("rejects missing timestamp", () => {
      const obs = { content: "Test" };
      const result = ObservationSchema.safeParse(obs);
      expect(result.success).toBe(false);
    });
  });

  describe("SessionMemorySchema", () => {
    const validSessionMemory = {
      sessionId: "test-1",
      task: "Fix bug in login",
      status: "merged",
      facts: ["Uses TypeScript", "pnpm workspaces"],
      entities: { "test command": "pnpm test" },
      observations: [{ content: "Tests pass on retry", ts: "2024-01-01T00:00:00Z" }],
      updatedAt: "2024-01-01T00:00:00Z",
      completedAt: "2024-01-01T00:00:00Z",
      version: 1 as const,
    };

    it("validates valid session memory", () => {
      const result = SessionMemorySchema.safeParse(validSessionMemory);
      expect(result.success).toBe(true);
    });

    it("rejects invalid version", () => {
      const invalid = { ...validSessionMemory, version: 2 };
      const result = SessionMemorySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("rejects missing required fields", () => {
      const { sessionId: _, ...missing } = validSessionMemory;
      const result = SessionMemorySchema.safeParse(missing);
      expect(result.success).toBe(false);
    });

    it("allows empty arrays", () => {
      const empty = { ...validSessionMemory, facts: [], observations: [] };
      const result = SessionMemorySchema.safeParse(empty);
      expect(result.success).toBe(true);
    });

    it("allows empty entities object", () => {
      const empty = { ...validSessionMemory, entities: {} };
      const result = SessionMemorySchema.safeParse(empty);
      expect(result.success).toBe(true);
    });
  });

  describe("ProjectMemorySchema", () => {
    const validProjectMemory = {
      facts: ["Fact 1", "Fact 2"],
      entities: { key: "value" },
      observations: [{ content: "Obs", ts: "2024-01-01T00:00:00Z" }],
      updatedAt: "2024-01-01T00:00:00Z",
      sessionCount: 5,
      version: 1 as const,
    };

    it("validates valid project memory", () => {
      const result = ProjectMemorySchema.safeParse(validProjectMemory);
      expect(result.success).toBe(true);
    });

    it("rejects negative session count", () => {
      const invalid = { ...validProjectMemory, sessionCount: -1 };
      const result = ProjectMemorySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("allows zero session count", () => {
      const zero = { ...validProjectMemory, sessionCount: 0 };
      const result = ProjectMemorySchema.safeParse(zero);
      expect(result.success).toBe(true);
    });
  });

  describe("ExtractionOutputSchema", () => {
    it("validates complete extraction output", () => {
      const output = {
        task: "Fix bug",
        facts: ["Fact 1"],
        entities: { key: "value" },
        observations: [{ content: "Obs" }],
      };
      const result = ExtractionOutputSchema.safeParse(output);
      expect(result.success).toBe(true);
    });

    it("allows partial extraction output", () => {
      const partial = { task: "Fix bug" };
      const result = ExtractionOutputSchema.safeParse(partial);
      expect(result.success).toBe(true);
    });

    it("allows empty extraction output", () => {
      const empty = {};
      const result = ExtractionOutputSchema.safeParse(empty);
      expect(result.success).toBe(true);
    });

    it("allows observations without timestamp", () => {
      const noTs = { observations: [{ content: "Obs" }] };
      const result = ExtractionOutputSchema.safeParse(noTs);
      expect(result.success).toBe(true);
    });
  });

  describe("Constants", () => {
    it("MEMORY_VERSION is 1", () => {
      expect(MEMORY_VERSION).toBe(1);
    });

    it("MAX_PROJECT_OBSERVATIONS is 20", () => {
      expect(MAX_PROJECT_OBSERVATIONS).toBe(20);
    });

    it("MEMORY_TRIGGER_STATUSES contains expected values", () => {
      expect(MEMORY_TRIGGER_STATUSES.has("merged")).toBe(true);
      expect(MEMORY_TRIGGER_STATUSES.has("done")).toBe(true);
      expect(MEMORY_TRIGGER_STATUSES.has("cleanup")).toBe(true);
      expect(MEMORY_TRIGGER_STATUSES.has("errored")).toBe(true);
      expect(MEMORY_TRIGGER_STATUSES.has("working")).toBe(false);
    });

    it("MEMORY_SKIP_STATUSES contains expected values", () => {
      expect(MEMORY_SKIP_STATUSES.has("killed")).toBe(true);
      expect(MEMORY_SKIP_STATUSES.has("terminated")).toBe(true);
      expect(MEMORY_SKIP_STATUSES.has("merged")).toBe(false);
    });
  });
});

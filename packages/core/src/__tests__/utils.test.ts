import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  isRetryableHttpStatus,
  normalizeRetryConfig,
  readLastJsonlEntry,
  shellEscape,
  escapeAppleScript,
  validateUrl,
  resolveProjectIdForSessionId,
} from "../utils.js";
import { parsePrFromUrl } from "../utils/pr.js";
import type { OrchestratorConfig } from "../types.js";

describe("readLastJsonlEntry", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  function setup(content: string): string {
    tmpDir = mkdtempSync(join(tmpdir(), "ao-utils-test-"));
    const filePath = join(tmpDir, "test.jsonl");
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  it("returns null for empty file", async () => {
    const path = setup("");
    expect(await readLastJsonlEntry(path)).toBeNull();
  });

  it("returns null for nonexistent file", async () => {
    expect(await readLastJsonlEntry("/tmp/nonexistent-ao-test.jsonl")).toBeNull();
  });

  it("reads last entry type from single-line JSONL", async () => {
    const path = setup('{"type":"assistant","message":"hello"}\n');
    const result = await readLastJsonlEntry(path);
    expect(result).not.toBeNull();
    expect(result!.lastType).toBe("assistant");
  });

  it("reads last entry from multi-line JSONL", async () => {
    const path = setup(
      '{"type":"human","text":"hi"}\n{"type":"assistant","text":"hello"}\n{"type":"result","text":"done"}\n',
    );
    const result = await readLastJsonlEntry(path);
    expect(result!.lastType).toBe("result");
  });

  it("handles trailing newlines", async () => {
    const path = setup('{"type":"done"}\n\n\n');
    const result = await readLastJsonlEntry(path);
    expect(result!.lastType).toBe("done");
  });

  it("returns lastType null for entry without type field", async () => {
    const path = setup('{"message":"no type"}\n');
    const result = await readLastJsonlEntry(path);
    expect(result).not.toBeNull();
    expect(result!.lastType).toBeNull();
  });

  it("returns null for invalid JSON", async () => {
    const path = setup("not json at all\n");
    expect(await readLastJsonlEntry(path)).toBeNull();
  });

  it("handles multi-byte UTF-8 characters in JSONL entries", async () => {
    // Create a JSONL entry with multi-byte characters (CJK, emoji)
    const entry = { type: "assistant", text: "日本語テスト 🎉 données résumé" };
    const path = setup(JSON.stringify(entry) + "\n");
    const result = await readLastJsonlEntry(path);
    expect(result!.lastType).toBe("assistant");
  });

  it("handles multi-byte UTF-8 at chunk boundaries", async () => {
    // Create content larger than the 4096 byte chunk size with multi-byte
    // characters that could straddle a boundary. Each 🎉 is 4 bytes.
    const padding = '{"type":"padding","data":"' + "x".repeat(4080) + '"}\n';
    // The emoji-heavy last line will be at a chunk boundary
    const lastLine = { type: "final", text: "🎉".repeat(100) };
    const path = setup(padding + JSON.stringify(lastLine) + "\n");
    const result = await readLastJsonlEntry(path);
    expect(result!.lastType).toBe("final");
  });

  it("returns modifiedAt as a Date", async () => {
    const path = setup('{"type":"test"}\n');
    const result = await readLastJsonlEntry(path);
    expect(result!.modifiedAt).toBeInstanceOf(Date);
  });
});

describe("retry utilities", () => {
  it("marks 429 and 5xx statuses as retryable", () => {
    expect(isRetryableHttpStatus(429)).toBe(true);
    expect(isRetryableHttpStatus(500)).toBe(true);
    expect(isRetryableHttpStatus(503)).toBe(true);
  });

  it("marks 4xx statuses (except 429) as non-retryable", () => {
    expect(isRetryableHttpStatus(400)).toBe(false);
    expect(isRetryableHttpStatus(401)).toBe(false);
    expect(isRetryableHttpStatus(404)).toBe(false);
  });

  it("normalizes retry config with defaults", () => {
    expect(normalizeRetryConfig(undefined)).toEqual({ retries: 2, retryDelayMs: 1000 });
  });

  it("normalizes retry config values and clamps invalid input", () => {
    expect(normalizeRetryConfig({ retries: 4, retryDelayMs: 250 })).toEqual({
      retries: 4,
      retryDelayMs: 250,
    });
    expect(normalizeRetryConfig({ retries: -1, retryDelayMs: -50 })).toEqual({
      retries: 0,
      retryDelayMs: 1000,
    });
  });
});

describe("parsePrFromUrl", () => {
  it("parses GitHub PR URLs", () => {
    expect(parsePrFromUrl("https://github.com/foo/bar/pull/123")).toEqual({
      owner: "foo",
      repo: "bar",
      number: 123,
      url: "https://github.com/foo/bar/pull/123",
    });
  });

  it("falls back to trailing number for non-GitHub URLs", () => {
    expect(parsePrFromUrl("https://gitlab.com/foo/bar/-/merge_requests/456")).toEqual({
      owner: "",
      repo: "",
      number: 456,
      url: "https://gitlab.com/foo/bar/-/merge_requests/456",
    });
  });

  it("returns null when the URL has no PR number", () => {
    expect(parsePrFromUrl("https://example.com/foo/bar/pull/not-a-number")).toBeNull();
  });
});

describe("shellEscape", () => {
  it("wraps simple string in single quotes", () => {
    expect(shellEscape("hello")).toBe("'hello'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellEscape("it's")).toBe("'it'\\''s'");
    expect(shellEscape("a'b'c")).toBe("'a'\\''b'\\''c'");
  });

  it("handles empty string", () => {
    expect(shellEscape("")).toBe("''");
  });

  it("handles string with only single quotes", () => {
    // For input "'''" (3 single quotes):
    // Each ' becomes '\'' (close, escaped quote, reopen)
    // So: ' + '\'''\'''\'' + ' = ''\'''\'''\'''
    expect(shellEscape("'''")).toBe("''\\'''\\'''\\'''");
  });

  it("handles strings with spaces and special characters", () => {
    expect(shellEscape("hello world")).toBe("'hello world'");
    expect(shellEscape("$PATH")).toBe("'$PATH'");
    expect(shellEscape('echo "test"')).toBe("'echo \"test\"'");
  });

  it("handles newlines and tabs", () => {
    expect(shellEscape("line1\nline2")).toBe("'line1\nline2'");
    expect(shellEscape("col1\tcol2")).toBe("'col1\tcol2'");
  });
});

describe("escapeAppleScript", () => {
  it("returns simple string unchanged", () => {
    expect(escapeAppleScript("hello")).toBe("hello");
  });

  it("escapes backslashes", () => {
    expect(escapeAppleScript("path\\to\\file")).toBe("path\\\\to\\\\file");
  });

  it("escapes double quotes", () => {
    expect(escapeAppleScript('say "hello"')).toBe('say \\"hello\\"');
  });

  it("escapes both backslashes and double quotes", () => {
    expect(escapeAppleScript('path\\to\\"file"')).toBe('path\\\\to\\\\\\"file\\"');
  });

  it("handles empty string", () => {
    expect(escapeAppleScript("")).toBe("");
  });
});

describe("validateUrl", () => {
  it("accepts https URLs", () => {
    expect(() => validateUrl("https://example.com", "test")).not.toThrow();
    expect(() => validateUrl("https://api.github.com/repos", "test")).not.toThrow();
  });

  it("accepts http URLs", () => {
    expect(() => validateUrl("http://localhost:3000", "test")).not.toThrow();
    expect(() => validateUrl("http://example.com/path", "test")).not.toThrow();
  });

  it("throws for invalid URLs", () => {
    expect(() => validateUrl("ftp://example.com", "myPlugin")).toThrow(
      '[myPlugin] Invalid url: must be http(s), got "ftp://example.com"',
    );
    expect(() => validateUrl("ws://socket.example.com", "webhook")).toThrow(
      '[webhook] Invalid url: must be http(s), got "ws://socket.example.com"',
    );
    expect(() => validateUrl("example.com", "test")).toThrow();
  });
});

describe("resolveProjectIdForSessionId", () => {
  const mockConfig: OrchestratorConfig = {
    configPath: "/tmp/test/agent-orchestrator.yaml",
    readyThresholdMs: 300000,
    defaults: {
      runtime: "tmux",
      agent: "claude-code",
      workspace: "worktree",
      notifiers: [],
    },
    projects: {
      frontend: {
        name: "Frontend",
        repo: "owner/frontend",
        path: "/path/to/frontend",
        defaultBranch: "main",
        sessionPrefix: "fe",
      },
      backend: {
        name: "Backend",
        repo: "owner/backend",
        path: "/path/to/backend",
        defaultBranch: "main",
        sessionPrefix: "be",
      },
      api: {
        name: "API",
        repo: "owner/api",
        path: "/path/to/api",
        defaultBranch: "main",
        sessionPrefix: "api",
      },
    },
    notifiers: {},
    notificationRouting: {
      urgent: [],
      action: [],
      warning: [],
      info: [],
    },
    reactions: {},
  };

  it("resolves project by exact prefix match", () => {
    expect(resolveProjectIdForSessionId(mockConfig, "fe")).toBe("frontend");
    expect(resolveProjectIdForSessionId(mockConfig, "be")).toBe("backend");
    expect(resolveProjectIdForSessionId(mockConfig, "api")).toBe("api");
  });

  it("resolves project by prefix with session number", () => {
    expect(resolveProjectIdForSessionId(mockConfig, "fe-1")).toBe("frontend");
    expect(resolveProjectIdForSessionId(mockConfig, "be-42")).toBe("backend");
    expect(resolveProjectIdForSessionId(mockConfig, "api-123")).toBe("api");
  });

  it("resolves project with hyphenated suffix", () => {
    expect(resolveProjectIdForSessionId(mockConfig, "fe-feature-branch")).toBe("frontend");
  });

  it("returns undefined for unknown session prefix", () => {
    expect(resolveProjectIdForSessionId(mockConfig, "unknown-1")).toBeUndefined();
    expect(resolveProjectIdForSessionId(mockConfig, "x")).toBeUndefined();
  });

  it("returns undefined for partial prefix match without hyphen", () => {
    // "f" is not "fe" and doesn't start with "fe-"
    expect(resolveProjectIdForSessionId(mockConfig, "f")).toBeUndefined();
    // "fee" is not "fe" and doesn't start with "fe-"
    expect(resolveProjectIdForSessionId(mockConfig, "fee")).toBeUndefined();
  });
});

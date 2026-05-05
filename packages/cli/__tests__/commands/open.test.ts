import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockExec, mockConfigRef, mockTmux, mockSessionManager, mockPromptGroupMultiselect } =
  vi.hoisted(() => ({
    mockExec: vi.fn(),
    mockTmux: vi.fn(),
    mockSessionManager: { list: vi.fn() },
    mockPromptGroupMultiselect: vi.fn(),
    mockConfigRef: { current: null as Record<string, unknown> | null },
  }));

vi.mock("../../src/lib/shell.js", () => ({
  exec: mockExec,
  execSilent: vi.fn(),
  tmux: mockTmux,
  git: vi.fn(),
  gh: vi.fn(),
  getTmuxSessions: async () => {
    const output = await mockTmux("list-sessions", "-F", "#{session_name}");
    if (!output) return [];
    return output.split("\n").filter(Boolean);
  },
  getTmuxActivity: vi.fn().mockResolvedValue(null),
}));

vi.mock("@aoagents/ao-core", () => ({
  loadConfig: () => mockConfigRef.current,
}));

vi.mock("../../src/lib/create-session-manager.js", () => ({
  getSessionManager: async () => mockSessionManager,
}));

vi.mock("../../src/lib/prompts.js", () => ({
  promptGroupMultiselect: mockPromptGroupMultiselect,
}));

import { Command } from "commander";
import { registerOpen } from "../../src/commands/open.js";

let program: Command;
let consoleSpy: ReturnType<typeof vi.spyOn>;
let originalStdinIsTTY: boolean | undefined;
let originalStdoutIsTTY: boolean | undefined;

function setTty(stdin: boolean | undefined, stdout: boolean | undefined): void {
  Object.defineProperty(process.stdin, "isTTY", { value: stdin, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: stdout, configurable: true });
}

function makeSession(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "app-1",
    projectId: "my-app",
    status: "working",
    activity: "active",
    activitySignal: { state: "valid", activity: "active", source: "runtime" },
    lifecycle: {
      version: 2,
      session: {
        kind: "worker",
        state: "working",
        reason: "task_in_progress",
        startedAt: null,
        completedAt: null,
        terminatedAt: null,
        lastTransitionAt: new Date().toISOString(),
      },
      pr: { state: "none", reason: "not_created", number: null, url: null, lastObservedAt: null },
      runtime: {
        state: "alive",
        reason: "process_running",
        lastObservedAt: null,
        handle: null,
        tmuxName: null,
      },
    },
    branch: "main",
    issueId: "1",
    pr: null,
    workspacePath: null,
    runtimeHandle: { id: "app-1", kind: "tmux" },
    agentInfo: null,
    createdAt: new Date(Date.now() - 10_000),
    lastActivityAt: new Date(Date.now() - 5_000),
    metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  originalStdinIsTTY = process.stdin.isTTY;
  originalStdoutIsTTY = process.stdout.isTTY;
  setTty(undefined, undefined);
  mockConfigRef.current = {
    dataDir: "/tmp/ao",
    worktreeDir: "/tmp/wt",
    port: 3000,
    defaults: {
      runtime: "tmux",
      agent: "claude-code",
      workspace: "worktree",
      notifiers: ["desktop"],
    },
    projects: {
      "my-app": {
        name: "My App",
        repo: "org/my-app",
        path: "/home/user/my-app",
        defaultBranch: "main",
        sessionPrefix: "app",
      },
      backend: {
        name: "Backend",
        repo: "org/backend",
        path: "/home/user/backend",
        defaultBranch: "main",
      },
    },
    notifiers: {},
    notificationRouting: {},
    reactions: {},
  } as Record<string, unknown>;

  program = new Command();
  program.exitOverride();
  registerOpen(program);
  consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new Error(`process.exit(${code})`);
  });

  mockExec.mockReset();
  mockTmux.mockReset();
  mockExec.mockResolvedValue({ stdout: "", stderr: "" });
  mockSessionManager.list.mockReset();
  mockPromptGroupMultiselect.mockReset();
});

afterEach(() => {
  setTty(originalStdinIsTTY, originalStdoutIsTTY);
  vi.restoreAllMocks();
});

describe("open command", () => {
  it("opens all sessions when target is 'all'", async () => {
    mockTmux.mockImplementation(async (...args: string[]) => {
      if (args[0] === "list-sessions") return "app-1\napp-2\nbackend-1";
      return null;
    });

    await program.parseAsync(["node", "test", "open", "all"]);

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Opening 3 sessions");
    expect(output).toContain("app-1");
    expect(output).toContain("app-2");
    expect(output).toContain("backend-1");
  });

  it("opens all sessions when no target given", async () => {
    mockTmux.mockImplementation(async (...args: string[]) => {
      if (args[0] === "list-sessions") return "app-1";
      return null;
    });

    await program.parseAsync(["node", "test", "open"]);

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Opening 1 session");
  });

  it("opens all sessions without prompting for non-TTY no-arg usage", async () => {
    setTty(false, false);
    mockTmux.mockImplementation(async (...args: string[]) => {
      if (args[0] === "list-sessions") return "app-1\nbackend-1";
      return null;
    });

    await program.parseAsync(["node", "test", "open"]);

    expect(mockPromptGroupMultiselect).not.toHaveBeenCalled();
    expect(mockSessionManager.list).not.toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Opening 2 sessions");
  });

  it("prompts with grouped sessions and opens selected sessions for TTY no-arg usage", async () => {
    setTty(true, true);
    const first = makeSession({
      id: "app-1",
      projectId: "my-app",
      branch: "feature/app",
      pr: { number: 12, url: "https://github.com/org/my-app/pull/12", branch: "feature/app" },
      runtimeHandle: { id: "1686e4aaaeaa-app-1", kind: "tmux" },
    });
    const second = makeSession({
      id: "backend-1",
      projectId: "backend",
      branch: "fix/backend",
      pr: null,
      runtimeHandle: { id: "backend-1", kind: "tmux" },
    });
    mockSessionManager.list.mockResolvedValue([second, first]);
    mockPromptGroupMultiselect.mockResolvedValue(["app-1"]);

    await program.parseAsync(["node", "test", "open"]);

    expect(mockTmux).not.toHaveBeenCalled();
    expect(mockPromptGroupMultiselect).toHaveBeenCalledTimes(1);
    const [, grouped] = mockPromptGroupMultiselect.mock.calls[0] as [
      string,
      Record<string, { label: string }[]>,
    ];
    expect(Object.keys(grouped)).toEqual(["Backend (backend)", "My App (my-app)"]);
    expect(grouped["My App (my-app)"]?.[0]?.label).toContain("app-1");
    expect(grouped["My App (my-app)"]?.[0]?.label).toContain("feature/app");
    expect(grouped["My App (my-app)"]?.[0]?.label).toContain("#12");
    expect(mockExec).toHaveBeenCalledWith("open-iterm-tab", ["1686e4aaaeaa-app-1"]);
  });

  it("does not open anything when TTY picker selection is empty", async () => {
    setTty(true, true);
    mockSessionManager.list.mockResolvedValue([makeSession({ id: "app-1" })]);
    mockPromptGroupMultiselect.mockResolvedValue([]);

    await program.parseAsync(["node", "test", "open"]);

    expect(mockExec).not.toHaveBeenCalled();
    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("No sessions to open");
  });

  it("opens sessions for a specific project", async () => {
    mockTmux.mockImplementation(async (...args: string[]) => {
      if (args[0] === "list-sessions") return "app-1\napp-2\nbackend-1";
      return null;
    });

    await program.parseAsync(["node", "test", "open", "my-app"]);

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Opening 2 sessions");
    expect(output).toContain("app-1");
    expect(output).toContain("app-2");
    expect(output).not.toContain("backend-1");
  });

  it("matches hashed tmux worker session names", async () => {
    mockTmux.mockImplementation(async (...args: string[]) => {
      if (args[0] === "list-sessions") return "1686e4aaaeaa-app-1\nbackend-1";
      return null;
    });

    await program.parseAsync(["node", "test", "open", "my-app"]);

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Opening 1 session");
    expect(output).toContain("1686e4aaaeaa-app-1");
    expect(output).not.toContain("backend-1");
  });

  it("opens a single session by name", async () => {
    mockTmux.mockImplementation(async (...args: string[]) => {
      if (args[0] === "list-sessions") return "app-1\napp-2";
      return null;
    });

    await program.parseAsync(["node", "test", "open", "app-1"]);

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("Opening 1 session");
    expect(output).toContain("app-1");
  });

  it("rejects unknown target", async () => {
    mockTmux.mockImplementation(async (...args: string[]) => {
      if (args[0] === "list-sessions") return "app-1";
      return null;
    });

    await expect(program.parseAsync(["node", "test", "open", "nonexistent"])).rejects.toThrow(
      "process.exit(1)",
    );
  });

  it("passes --new-window flag to open-iterm-tab", async () => {
    mockTmux.mockImplementation(async (...args: string[]) => {
      if (args[0] === "list-sessions") return "app-1";
      return null;
    });

    await program.parseAsync(["node", "test", "open", "-w", "app-1"]);

    expect(mockExec).toHaveBeenCalledWith("open-iterm-tab", ["--new-window", "app-1"]);
  });

  it("falls back gracefully when open-iterm-tab fails", async () => {
    mockTmux.mockImplementation(async (...args: string[]) => {
      if (args[0] === "list-sessions") return "app-1";
      return null;
    });
    mockExec.mockRejectedValue(new Error("command not found"));

    await program.parseAsync(["node", "test", "open", "app-1"]);

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("http://localhost:3000/projects/my-app/sessions/app-1");
  });

  it("falls back to the owning project for orchestrator sessions", async () => {
    mockTmux.mockImplementation(async (...args: string[]) => {
      if (args[0] === "list-sessions") return "app-orchestrator";
      return null;
    });
    mockExec.mockRejectedValue(new Error("command not found"));

    await program.parseAsync(["node", "test", "open", "app-orchestrator"]);

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("http://localhost:3000/projects/my-app/sessions/app-orchestrator");
  });

  it("shows 'No sessions to open' when none exist", async () => {
    mockTmux.mockResolvedValue(null);

    await program.parseAsync(["node", "test", "open", "my-app"]);

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("No sessions to open");
  });
});

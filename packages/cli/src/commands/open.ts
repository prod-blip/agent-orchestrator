import chalk from "chalk";
import type { Command } from "commander";
import { loadConfig, type OrchestratorConfig, type Session } from "@aoagents/ao-core";
import { exec, getTmuxSessions } from "../lib/shell.js";
import { findProjectForSession, matchesPrefix, stripHashPrefix } from "../lib/session-utils.js";
import { DEFAULT_PORT } from "../lib/constants.js";
import { projectSessionUrl } from "../lib/routes.js";
import { formatAge, padCol, statusColor } from "../lib/format.js";
import { getSessionManager } from "../lib/create-session-manager.js";
import { promptGroupMultiselect } from "../lib/prompts.js";

const TERMINAL_STATUSES = new Set(["killed", "terminated", "done", "cleanup", "errored", "merged"]);

async function openInTerminal(sessionName: string, newWindow?: boolean): Promise<boolean> {
  try {
    const args = newWindow ? ["--new-window", sessionName] : [sessionName];
    await exec("open-iterm-tab", args);
    return true;
  } catch {
    // Fall back to tmux attach hint
    return false;
  }
}

function isInteractiveNoArgOpen(target: string | undefined): boolean {
  return !target && process.stdin.isTTY === true && process.stdout.isTTY === true;
}

function isLiveSession(session: Session): boolean {
  return !TERMINAL_STATUSES.has(session.status) && session.activity !== "exited";
}

function sessionOpenName(session: Session): string {
  return session.runtimeHandle?.id ?? session.id;
}

function formatLastActivity(session: Session): string {
  const timestamp = session.lastActivityAt.getTime();
  return Number.isNaN(timestamp) ? "-" : formatAge(timestamp);
}

function formatPr(session: Session): string {
  if (session.pr?.number) return `#${session.pr.number}`;
  if (session.lifecycle.pr.number) return `#${session.lifecycle.pr.number}`;
  const metadataPr = session.metadata["pr"];
  const match = metadataPr ? /\/pull\/(\d+)/.exec(metadataPr) : null;
  return match ? `#${match[1]}` : "-";
}

function pickerLabel(session: Session): string {
  const branch = session.branch ?? "-";
  return [
    padCol(session.id, 24),
    padCol(statusColor(session.status), 18),
    padCol(branch, 24),
    padCol(formatLastActivity(session), 12),
    formatPr(session),
  ].join("  ");
}

function projectLabel(config: OrchestratorConfig, projectId: string): string {
  const projectName = config.projects[projectId]?.name;
  return projectName && projectName !== projectId ? `${projectName} (${projectId})` : projectId;
}

async function pickSessionsToOpen(config: OrchestratorConfig): Promise<Session[]> {
  const sm = await getSessionManager(config);
  const sessions = (await sm.list()).filter(isLiveSession).sort((a, b) => {
    const projectOrder = a.projectId.localeCompare(b.projectId);
    return projectOrder === 0 ? a.id.localeCompare(b.id) : projectOrder;
  });

  if (sessions.length === 0) return [];

  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const grouped: Record<string, { value: string; label: string; hint?: string }[]> = {};

  for (const session of sessions) {
    const label = projectLabel(config, session.projectId);
    grouped[label] ??= [];
    grouped[label].push({
      value: session.id,
      label: pickerLabel(session),
      hint: session.pr?.url ?? session.metadata["pr"] ?? undefined,
    });
  }

  console.log(chalk.dim("Columns: id, status, branch, last activity, PR"));
  const selectedIds = await promptGroupMultiselect(
    "Select sessions to open (space to toggle, enter to open)",
    grouped,
  );

  return selectedIds.flatMap((id) => {
    const session = sessionsById.get(id);
    return session ? [session] : [];
  });
}

function sessionsForTarget(
  config: OrchestratorConfig,
  allTmux: string[],
  target: string | undefined,
): string[] {
  if (!target || target === "all") {
    const sessionsToOpen: string[] = [];
    // Open all sessions across all projects
    for (const [projectId, project] of Object.entries(config.projects)) {
      const prefix = project.sessionPrefix || projectId;
      const matching = allTmux.filter((s) => matchesPrefix(s, prefix));
      sessionsToOpen.push(...matching);
    }
    return sessionsToOpen;
  }

  if (config.projects[target]) {
    // Open all sessions for a specific project
    const project = config.projects[target];
    const prefix = project.sessionPrefix || target;
    return allTmux.filter((s) => matchesPrefix(s, prefix));
  }

  if (allTmux.includes(target)) {
    // Open a specific session
    return [target];
  }

  console.error(
    chalk.red(`Unknown target: ${target}\nSpecify a session name, project ID, or "all".`),
  );
  process.exit(1);
}

async function openSessions(
  sessionsToOpen: string[],
  config: OrchestratorConfig,
  target: string | undefined,
  newWindow: boolean | undefined,
  projectBySession?: Map<string, string>,
): Promise<void> {
  if (sessionsToOpen.length === 0) {
    console.log(chalk.dim("No sessions to open."));
    return;
  }

  console.log(
    chalk.bold(
      `Opening ${sessionsToOpen.length} session${sessionsToOpen.length > 1 ? "s" : ""}...\n`,
    ),
  );

  const port = config.port ?? DEFAULT_PORT;
  for (const session of sessionsToOpen.sort()) {
    const opened = await openInTerminal(session, newWindow);
    if (opened) {
      console.log(chalk.green(`  Opened: ${session}`));
    } else {
      const sessionId = stripHashPrefix(session);
      const matchedProjectId =
        projectBySession?.get(session) ??
        findProjectForSession(config, session) ??
        target ??
        sessionId;
      console.log(
        `  ${chalk.yellow(session)} — view at: ${chalk.dim(projectSessionUrl(port, matchedProjectId, sessionId))}`,
      );
    }
  }
  console.log();
}

export function registerOpen(program: Command): void {
  program
    .command("open")
    .description("Open session(s) in terminal tabs")
    .argument("[target]", 'Session name, project ID, or "all" to open everything')
    .option("-w, --new-window", "Open in a new terminal window")
    .action(async (target: string | undefined, opts: { newWindow?: boolean }) => {
      const config = loadConfig();

      if (isInteractiveNoArgOpen(target)) {
        const selectedSessions = await pickSessionsToOpen(config);
        if (selectedSessions.length === 0) {
          console.log(chalk.dim("No sessions to open."));
          return;
        }

        const projectBySession = new Map<string, string>();
        const sessionsToOpen = selectedSessions.map((session) => {
          const openName = sessionOpenName(session);
          projectBySession.set(openName, session.projectId);
          return openName;
        });
        await openSessions(sessionsToOpen, config, target, opts.newWindow, projectBySession);
        return;
      }

      const allTmux = await getTmuxSessions();
      const sessionsToOpen = sessionsForTarget(config, allTmux, target);
      await openSessions(sessionsToOpen, config, target, opts.newWindow);
    });
}

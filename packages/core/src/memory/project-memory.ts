/**
 * Project Memory — read/write/consolidate operations for project-level memory.
 *
 * Storage: project-memory.json at the project base directory
 * ~/.agent-orchestrator/{hash}-{projectId}/project-memory.json
 *
 * Consolidation rules:
 * - Facts: Add new, skip case-insensitive duplicates
 * - Entities: Merge by key, newer value wins
 * - Observations: Append, keep most recent 20
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import {
  ProjectMemorySchema,
  MEMORY_VERSION,
  MAX_PROJECT_OBSERVATIONS,
} from "./types.js";
import type { ProjectMemory, SessionMemory } from "./types.js";

/**
 * Get the path to the project memory file.
 */
export function getProjectMemoryPath(projectBaseDir: string): string {
  return join(projectBaseDir, "project-memory.json");
}

/**
 * Check if project memory exists.
 */
export function projectMemoryExists(projectBaseDir: string): boolean {
  return existsSync(getProjectMemoryPath(projectBaseDir));
}

/**
 * Read project memory from disk.
 * Returns null if the file doesn't exist or is invalid.
 */
export async function readProjectMemory(
  projectBaseDir: string,
): Promise<ProjectMemory | null> {
  const filePath = getProjectMemoryPath(projectBaseDir);

  try {
    const content = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(content);
    const result = ProjectMemorySchema.safeParse(parsed);

    if (result.success) {
      return result.data;
    }

    // Schema validation failed — file may be corrupted or from old version
    return null;
  } catch {
    // File doesn't exist or couldn't be read
    return null;
  }
}

/**
 * Write project memory to disk.
 * Validates the data before writing.
 */
export async function writeProjectMemory(
  projectBaseDir: string,
  memory: ProjectMemory,
): Promise<void> {
  const filePath = getProjectMemoryPath(projectBaseDir);

  // Validate before writing
  const result = ProjectMemorySchema.safeParse(memory);
  if (!result.success) {
    throw new Error(`Invalid project memory: ${result.error.message}`);
  }

  // Ensure directory exists
  await mkdir(dirname(filePath), { recursive: true });

  const content = JSON.stringify(result.data, null, 2);
  await writeFile(filePath, content, "utf-8");
}

/**
 * Create an empty project memory object.
 */
export function createEmptyProjectMemory(): ProjectMemory {
  return {
    facts: [],
    entities: {},
    observations: [],
    updatedAt: new Date().toISOString(),
    sessionCount: 0,
    version: MEMORY_VERSION,
  };
}

/**
 * Check if a fact already exists (case-insensitive comparison).
 */
function factExists(facts: string[], newFact: string): boolean {
  const normalized = newFact.toLowerCase().trim();
  return facts.some((f) => f.toLowerCase().trim() === normalized);
}

/**
 * Consolidate session memory into project memory.
 *
 * Rules:
 * - Facts: Add new facts, skip case-insensitive duplicates
 * - Entities: Merge by key, newer value wins
 * - Observations: Append new observations, keep most recent MAX_PROJECT_OBSERVATIONS
 */
export function consolidateMemory(
  projectMemory: ProjectMemory,
  sessionMemory: SessionMemory,
): ProjectMemory {
  const now = new Date().toISOString();

  // Consolidate facts (add new, skip duplicates)
  const newFacts = sessionMemory.facts.filter(
    (fact) => !factExists(projectMemory.facts, fact),
  );
  const consolidatedFacts = [...projectMemory.facts, ...newFacts];

  // Consolidate entities (merge, newer wins)
  const consolidatedEntities = {
    ...projectMemory.entities,
    ...sessionMemory.entities,
  };

  // Consolidate observations (append, cap at MAX_PROJECT_OBSERVATIONS)
  // Sort by timestamp descending, keep most recent
  const allObservations = [
    ...sessionMemory.observations,
    ...projectMemory.observations,
  ].sort((a, b) => {
    // Parse timestamps and sort descending (most recent first)
    const dateA = new Date(a.ts).getTime();
    const dateB = new Date(b.ts).getTime();
    return dateB - dateA;
  });
  const consolidatedObservations = allObservations.slice(0, MAX_PROJECT_OBSERVATIONS);

  return {
    facts: consolidatedFacts,
    entities: consolidatedEntities,
    observations: consolidatedObservations,
    updatedAt: now,
    sessionCount: projectMemory.sessionCount + 1,
    version: MEMORY_VERSION,
  };
}

/**
 * Consolidate session memory into project memory and write to disk.
 * Creates project memory file if it doesn't exist.
 */
export async function consolidateAndWriteProjectMemory(
  projectBaseDir: string,
  sessionMemory: SessionMemory,
): Promise<ProjectMemory> {
  // Read existing project memory or create empty
  const existing = await readProjectMemory(projectBaseDir);
  const projectMemory = existing ?? createEmptyProjectMemory();

  // Consolidate
  const consolidated = consolidateMemory(projectMemory, sessionMemory);

  // Write
  await writeProjectMemory(projectBaseDir, consolidated);

  return consolidated;
}

/**
 * Format project memory for injection into agent prompts.
 * Returns a markdown-formatted string suitable for the memory layer.
 */
export function formatProjectMemoryForPrompt(memory: ProjectMemory): string {
  const sections: string[] = [];

  // Facts section
  if (memory.facts.length > 0) {
    sections.push("### Project Knowledge");
    sections.push(memory.facts.map((f) => `- ${f}`).join("\n"));
  }

  // Entities section
  const entityEntries = Object.entries(memory.entities);
  if (entityEntries.length > 0) {
    sections.push("### Key References");
    sections.push(entityEntries.map(([k, v]) => `- **${k}**: ${v}`).join("\n"));
  }

  // Recent observations (only include last 5 in prompt to avoid bloat)
  const recentObs = memory.observations.slice(0, 5);
  if (recentObs.length > 0) {
    sections.push("### Recent Observations");
    sections.push(recentObs.map((o) => `- ${o.content}`).join("\n"));
  }

  if (sections.length === 0) {
    return "";
  }

  return `## Project Memory\n\nThis project has accumulated knowledge from ${memory.sessionCount} previous sessions:\n\n${sections.join("\n\n")}`;
}

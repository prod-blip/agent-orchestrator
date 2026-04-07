/**
 * Extraction Prompt — template for memory extraction from transcripts.
 *
 * The extraction prompt is sent to a quick agent session to analyze
 * a completed session's transcript and extract structured knowledge.
 */

/**
 * Build the extraction prompt for a session transcript.
 *
 * @param projectName - Name of the project
 * @param sessionId - Session identifier
 * @param status - Final session status
 * @param transcript - Formatted transcript text
 */
export function buildExtractionPrompt(
  projectName: string,
  sessionId: string,
  status: string,
  transcript: string,
): string {
  return `You are extracting structured knowledge from an AI coding session transcript.

## Context
- Project: ${projectName}
- Session: ${sessionId}
- Final Status: ${status}

## Task
Analyze the following transcript and extract:

1. **Task Summary**: A brief (1-2 sentence) description of what task was being worked on.

2. **Facts**: Project-specific learnings that would help future sessions. Examples:
   - "The project uses pnpm workspaces with strict mode"
   - "Tests must pass CI before merging"
   - "The API rate-limits at 100 requests per minute"
   - "Configuration is in agent-orchestrator.yaml"

3. **Entities**: Key-value pairs of important references discovered. Examples:
   - "main entry point" → "packages/core/src/index.ts"
   - "test command" → "pnpm test"
   - "CI config" → ".github/workflows/ci.yml"
   - "style guide" → "docs/STYLE.md"

4. **Observations**: Specific insights about how work was done. Examples:
   - "Used the Edit tool instead of Write for safer file modifications"
   - "Had to run npm install after package.json changes"
   - "Tests flaked on first run but passed on retry"

## Transcript
\`\`\`
${transcript}
\`\`\`

## Output Format
Respond with ONLY a JSON object (no markdown code blocks, no explanation):

{
  "task": "Brief description of what was worked on",
  "facts": [
    "Fact 1 about the project",
    "Fact 2 about the project"
  ],
  "entities": {
    "key1": "value1",
    "key2": "value2"
  },
  "observations": [
    {"content": "Observation 1"},
    {"content": "Observation 2"}
  ]
}

Focus on information that would genuinely help future coding sessions in this project.
Avoid generic statements — be specific about THIS project.
If the transcript is too short or unclear to extract meaningful knowledge, return minimal/empty arrays.`;
}

/**
 * Build a minimal extraction prompt for quick/cheap extraction.
 * Used when we want to minimize token usage.
 */
export function buildMinimalExtractionPrompt(
  sessionId: string,
  status: string,
  transcript: string,
): string {
  return `Extract knowledge from this coding session (${sessionId}, status: ${status}).

Transcript:
${transcript}

Return JSON only:
{"task":"...", "facts":["..."], "entities":{"key":"value"}, "observations":[{"content":"..."}]}`;
}

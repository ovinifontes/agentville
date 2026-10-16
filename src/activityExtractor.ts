// src/activityExtractor.ts
// Derives the one-line "what is this agent doing right now" string shown in the office
// speech bubble, from the last tool_use of an agent's most recent assistant turn.
//
// The transcript format is undocumented and changes between Claude Code releases, so every
// access here is defensive: an unrecognised shape yields `undefined` (keep the previous
// action) or the generic 'Working', never an exception and never a raw tool id.
//
// Antigravity is an explicit no-op: its entries carry no `message` and no Claude-style
// tool_use blocks (its calls are a different shape — subagentDetector.ts's
// detectAntigravityCalls), so every one fails isAssistantTurn and yields `undefined`. The
// office does not even read those transcripts (subagentTranscriptReader.ts's workingTranscripts).

const MAX_COMMAND_CHARS = 30;

interface ToolUse {
  name: string;
  input: Record<string, unknown>;
}

function basename(filePath: string): string {
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function contentOf(entry: unknown): unknown[] | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }
  const message = (entry as { message?: unknown }).message;
  if (typeof message !== 'object' || message === null) {
    return undefined;
  }
  const content = (message as { content?: unknown }).content;
  return Array.isArray(content) ? content : undefined;
}

/** The last tool_use block of an assistant turn, or undefined when there is none. */
function lastToolUse(entry: unknown): ToolUse | undefined {
  const content = contentOf(entry);
  if (!content) {
    return undefined;
  }
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i] as { type?: unknown; name?: unknown; input?: unknown } | null;
    if (block?.type === 'tool_use' && typeof block.name === 'string') {
      return { name: block.name, input: (block.input as Record<string, unknown> | undefined) ?? {} };
    }
  }
  return undefined;
}

function isAssistantTurn(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) {
    return false;
  }
  const typed = entry as { type?: unknown; message?: unknown };
  // Bookkeeping entries (attachment / last-prompt / queue-operation / ai-title) trail every
  // real turn and carry no `message` — gating on `type` alone would misread them as turns.
  if (typeof typed.message !== 'object' || typed.message === null) {
    return false;
  }
  return typed.type === 'assistant';
}

type Renderer = (input: Record<string, unknown>) => string;

/** "<verb> <target>" when a target is known, else the bare verb. */
function withTarget(verb: string, target: string | undefined, joiner = ' '): string {
  return target ? `${verb}${joiner}${target}` : verb;
}

function fileOf(input: Record<string, unknown>): string | undefined {
  const file = asString(input.file_path);
  return file && basename(file);
}

function renderEdit(input: Record<string, unknown>): string {
  const notebook = asString(input.notebook_path);
  return withTarget('Editing', fileOf(input) ?? (notebook && basename(notebook)));
}

function renderBash(input: Record<string, unknown>): string {
  const command = asString(input.command);
  if (!command) {
    return 'Running a command';
  }
  return `Running ${command.length > MAX_COMMAND_CHARS ? `${command.slice(0, MAX_COMMAND_CHARS)}…` : command}`;
}

const researching: Renderer = () => 'Researching';
const searching: Renderer = (input) => withTarget('Searching', asString(input.pattern), ' for ');
const delegating: Renderer = (input) =>
  withTarget('Delegating', asString(input.subagent_type) ?? asString(input.description), ' to ');

const RENDERERS: Partial<Record<string, Renderer>> = {
  Read: (input) => withTarget('Reading', fileOf(input)),
  Edit: renderEdit,
  Write: renderEdit,
  NotebookEdit: renderEdit,
  Bash: renderBash,
  Grep: searching,
  Glob: searching,
  Agent: delegating,
  Task: delegating,
  WebSearch: researching,
  WebFetch: researching,
  TodoWrite: () => 'Planning',
};

function renderTool(tool: ToolUse): string {
  return Object.hasOwn(RENDERERS, tool.name) ? (RENDERERS[tool.name]?.(tool.input) ?? 'Working') : 'Working';
}

/**
 * The current action for an agent, from one transcript entry.
 * `undefined` means "this entry says nothing about activity" — the caller keeps whatever
 * action it already had.
 */
export function extractAction(entry: unknown): string | undefined {
  try {
    if (!isAssistantTurn(entry)) {
      return undefined;
    }
    const tool = lastToolUse(entry);
    return tool ? renderTool(tool) : 'Thinking';
  } catch {
    return undefined;
  }
}

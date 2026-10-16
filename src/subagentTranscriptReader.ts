// Reads a subagent's own transcript — the file the tree view never needed. Subagent
// transcripts live at `<session-dir>/<session-id>/subagents/agent-<id>.jsonl`; the parent
// transcript only records the launch and the completion, so the live picture of what a
// subagent is doing exists nowhere else.
//
// Incremental by the same rule as LogParser: cache a byte offset per file and read only
// what was appended. Only WORKING subagents should be passed here — a finished subagent
// cannot produce a new action, and opening every completed one would multiply I/O by the
// number of agents the session has ever launched.

import * as fs from 'fs';
import * as path from 'path';
import { extractAction } from './activityExtractor';
import { splitCompleteLines } from './completeLines';
import { logDebug } from './logger';
import type { FeedEntry } from './officeTypes';
import type { Session } from './types';

export interface SubagentRead {
  action?: string;
  entries: FeedEntry[];
}

/** `/logs/proj/session-1.jsonl` + `abc` → `/logs/proj/session-1/subagents/agent-abc.jsonl` */
export function subagentTranscriptPath(sessionLogPath: string, agentId: string): string {
  const dir = path.dirname(sessionLogPath);
  const sessionId = path.basename(sessionLogPath, '.jsonl');
  return path.join(dir, sessionId, 'subagents', `agent-${agentId}.jsonl`);
}

/**
 * The transcripts a refresh should read for one session: every WORKING agent in it — the
 * session itself, its subagents and their grandchildren — each gated on its own status, never
 * the session's. A session reads 'stopped' after 30 min without writes while a long subagent it
 * launched is still running (see subagentGrouping.ts), so gating the walk on the session would
 * freeze exactly the agents doing the work. Antigravity yields nothing: its log shapes carry no
 * Claude-style tool_use (activityExtractor.ts), so reading them would cost I/O for no action.
 */
export function workingTranscripts(session: Session): Array<{ id: string; path: string }> {
  if (session.type === 'antigravity') {
    return [];
  }
  const own = session.status === 'working' ? [{ id: session.id, path: session.logFilePath }] : [];
  const subagents = session.subagents
    .flatMap((subagent) => [subagent, ...(subagent.children ?? [])])
    .filter((subagent) => subagent.status === 'working')
    .map((subagent) => ({
      id: subagent.id,
      path: subagentTranscriptPath(session.logFilePath, subagent.agentId ?? subagent.id),
    }));
  return [...own, ...subagents];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

function textOf(message: Record<string, unknown>): string {
  const content = message['content'];
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((block) => asRecord(block))
    .filter((block) => block?.['type'] === 'text')
    .map((block) => (typeof block?.['text'] === 'string' ? block['text'] : ''))
    .join('\n');
}

function timestampOf(value: unknown): number {
  const at = typeof value === 'string' ? Date.parse(value) : Date.now();
  return Number.isNaN(at) ? Date.now() : at;
}

function toFeedEntry(entry: unknown): FeedEntry | undefined {
  const typed = asRecord(entry) ?? {};
  const type = typed['type'];
  const message = asRecord(typed['message']);
  if ((type !== 'assistant' && type !== 'user') || !message) {
    return undefined;
  }
  const text = textOf(message);
  const action = extractAction(entry);
  if (!text && !action) {
    return undefined;
  }
  return { role: type, text: text || (action ?? ''), tool: action, at: timestampOf(typed['timestamp']) };
}

function readBytes(transcriptPath: string, start: number, end: number): Buffer {
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    const buffer = Buffer.alloc(end - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

function parseLines(lines: string[]): SubagentRead {
  const entries: FeedEntry[] = [];
  let action: string | undefined;
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      const feed = toFeedEntry(parsed);
      if (feed) {
        entries.push(feed);
      }
      action = extractAction(parsed) ?? action;
    } catch {
      // Complete lines only reach here, so a line that fails to parse is genuinely malformed.
    }
  }
  return { action, entries };
}

export class SubagentTranscriptReader {
  private readonly offsets = new Map<string, number>();

  read(transcriptPath: string): SubagentRead {
    try {
      if (!fs.existsSync(transcriptPath)) {
        return { action: undefined, entries: [] };
      }
      const size = fs.statSync(transcriptPath).size;
      const previous = this.offsets.get(transcriptPath) ?? 0;
      // A file that shrank was rotated or rewritten — start over rather than read garbage.
      const start = size < previous ? 0 : previous;
      if (size === start) {
        return { action: undefined, entries: [] };
      }
      const chunk = readBytes(transcriptPath, start, size);
      // Same strategy as LogParser: a chunk read mid-append can end partway through the line
      // being written (no trailing '\n' yet). Parsing that fragment would drop it, and the next
      // read would start mid-JSON and drop the remainder too, losing the entry for good. So hold
      // the fragment back: don't advance the offset past it, and re-read it whole once finished.
      // A chunk with no newline at all is entirely a fragment and leaves the offset unchanged.
      // Split on the raw bytes (completeLines.ts): a chunk can also end mid-character.
      const { lines, bytes } = splitCompleteLines(chunk);
      if (bytes > 0) {
        this.offsets.set(transcriptPath, start + bytes);
      }
      return parseLines(lines);
    } catch (error) {
      logDebug(`SubagentTranscriptReader.read failed for ${transcriptPath}: ${String(error)}`);
      return { action: undefined, entries: [] };
    }
  }
}

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SubagentTranscriptReader, subagentTranscriptPath, workingTranscripts } from '../subagentTranscriptReader';
import type { Session, SubAgent } from '../types';

const tempDir = path.join(os.tmpdir(), 'agentville-subagent-test');
const filePath = path.join(tempDir, 'agent-abc.jsonl');

function assistantLine(toolName: string, input: Record<string, unknown>): string {
  return `${JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-13T10:00:00.000Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: toolName, input }] },
  })}\n`;
}

describe('subagentTranscriptPath', () => {
  it('resolves the subagents directory next to the session transcript', () => {
    const result = subagentTranscriptPath('/logs/proj/session-1.jsonl', 'abc');
    expect(result).toBe(path.join('/logs/proj', 'session-1', 'subagents', 'agent-abc.jsonl'));
  });
});

describe('workingTranscripts', () => {
  const logFilePath = '/logs/proj/s1.jsonl';
  const sub = (id: string, status: SubAgent['status'], over: Partial<SubAgent> = {}): SubAgent => ({
    id,
    name: id,
    task: 't',
    status,
    ...over,
  });
  const session = (over: Partial<Session>): Session => ({
    id: 's1',
    projectHash: 'h',
    projectPath: '/p',
    projectName: 'p',
    gitBranch: 'main',
    status: 'working',
    lastInteractionTime: 0,
    subagents: [],
    logFilePath,
    type: 'claude-code',
    ...over,
  });

  it('reads working subagents and grandchildren even while the session reads stopped', () => {
    const subagents = [
      sub('a', 'working', { agentId: 'raw-a', children: [sub('c', 'working'), sub('d', 'stopped')] }),
      sub('b', 'stopped'),
    ];
    expect(workingTranscripts(session({ status: 'stopped', subagents }))).toEqual([
      { id: 'a', path: subagentTranscriptPath(logFilePath, 'raw-a') },
      { id: 'c', path: subagentTranscriptPath(logFilePath, 'c') },
    ]);
  });

  it("reads the session's own transcript only while it is working", () => {
    expect(workingTranscripts(session({}))).toEqual([{ id: 's1', path: logFilePath }]);
    expect(workingTranscripts(session({ status: 'stopped' }))).toEqual([]);
  });

  it('reads nothing for Antigravity, whose logs carry no Claude-style tool_use', () => {
    expect(workingTranscripts(session({ type: 'antigravity', subagents: [sub('a', 'working')] }))).toEqual([]);
  });
});

describe('SubagentTranscriptReader', () => {
  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(filePath, '');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns an empty result for a missing file and does not throw', () => {
    const reader = new SubagentTranscriptReader();
    expect(reader.read(path.join(tempDir, 'nope.jsonl'))).toEqual({ action: undefined, entries: [] });
  });

  it('extracts the action from the last assistant turn', () => {
    fs.writeFileSync(filePath, assistantLine('Read', { file_path: '/a/types.ts' }));
    const reader = new SubagentTranscriptReader();
    expect(reader.read(filePath).action).toBe('Reading types.ts');
  });

  it('reads only appended bytes on a second call', () => {
    fs.writeFileSync(filePath, assistantLine('Read', { file_path: '/a/one.ts' }));
    const reader = new SubagentTranscriptReader();
    expect(reader.read(filePath).entries).toHaveLength(1);

    fs.appendFileSync(filePath, assistantLine('Bash', { command: 'npm test' }));
    const second = reader.read(filePath);
    expect(second.entries).toHaveLength(1);
    expect(second.action).toBe('Running npm test');
  });

  it('returns no new entries when nothing was appended', () => {
    fs.writeFileSync(filePath, assistantLine('Read', { file_path: '/a/one.ts' }));
    const reader = new SubagentTranscriptReader();
    reader.read(filePath);
    expect(reader.read(filePath).entries).toEqual([]);
  });

  it('re-reads from the start when the file shrinks (rotation)', () => {
    fs.writeFileSync(filePath, assistantLine('Read', { file_path: '/a/one.ts' }));
    const reader = new SubagentTranscriptReader();
    reader.read(filePath);

    fs.writeFileSync(filePath, assistantLine('Bash', { command: 'ls' }));
    expect(reader.read(filePath).entries).toHaveLength(1);
  });

  it('skips malformed lines without throwing', () => {
    fs.writeFileSync(filePath, `not json\n${assistantLine('Read', { file_path: '/a/ok.ts' })}{"broken":\n`);
    const reader = new SubagentTranscriptReader();
    const result = reader.read(filePath);
    expect(result.action).toBe('Reading ok.ts');
    expect(result.entries).toHaveLength(1);
  });

  it('ignores bookkeeping entries', () => {
    fs.writeFileSync(filePath, `${JSON.stringify({ type: 'ai-title' })}\n`);
    const reader = new SubagentTranscriptReader();
    expect(reader.read(filePath)).toEqual({ action: undefined, entries: [] });
  });

  it('holds back a partially written trailing line until it is complete', () => {
    const line = assistantLine('Read', { file_path: '/a/split.ts' });
    const cut = Math.floor(line.length / 2);
    fs.writeFileSync(filePath, line.slice(0, cut));
    const reader = new SubagentTranscriptReader();
    expect(reader.read(filePath)).toEqual({ action: undefined, entries: [] });

    fs.appendFileSync(filePath, line.slice(cut));
    const second = reader.read(filePath);
    expect(second.entries).toHaveLength(1);
    expect(second.action).toBe('Reading split.ts');
  });

  describe('a read that ends inside a multi-byte character', () => {
    const line = Buffer.from(assistantLine('Read', { file_path: '/a/configuração.ts' }), 'utf8');
    // One byte into the two-byte "ã": the fragment on disk ends mid-character.
    const cut = line.indexOf(Buffer.from('ã', 'utf8')) + 1;

    it('recovers a torn first line once the writer finishes it', () => {
      fs.writeFileSync(filePath, line.subarray(0, cut));
      const reader = new SubagentTranscriptReader();
      expect(reader.read(filePath)).toEqual({ action: undefined, entries: [] });

      fs.appendFileSync(filePath, line.subarray(cut));
      expect(reader.read(filePath).action).toBe('Reading configuração.ts');
    });

    it('recovers a torn line after complete ones, and nothing else', () => {
      fs.writeFileSync(filePath, Buffer.concat([line, line.subarray(0, cut)]));
      const reader = new SubagentTranscriptReader();
      expect(reader.read(filePath).entries).toHaveLength(1);

      fs.appendFileSync(filePath, line.subarray(cut));
      const second = reader.read(filePath);
      expect(second.entries).toHaveLength(1);
      expect(second.action).toBe('Reading configuração.ts');
      expect(reader.read(filePath).entries).toEqual([]);
    });
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { LogParser } from '../logParser';

// Fixtures are snapshots of real Claude Code session logs, captured while investigating a bug
// where subagents spawned via forks / `/loop` / `/goal` never left the "Working Agents" group in
// the sidebar. The transcript *structure* is untouched — that is what these tests exercise — but
// every free-form text, path and branch name was replaced with placeholders before this repository
// went public, so the asserted titles/tasks read as `Sample text N`. The number is the redaction
// counter, stable per file: what each assert proves is that the value came from the right field,
// not what the value says.
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'real-logs');

describe('LogParser against real Claude Code logs', () => {
  it('marks every subagent stopped once its nested tool_result lands (burst of 46 subagents)', () => {
    const parser = new LogParser();
    const filePath = path.join(FIXTURES_DIR, 'session-many-subagents.jsonl');

    const session = parser.parse(filePath, 'claude-code');

    expect(session.gitBranch).toBe('fix/713-typed-wrapper-context');
    expect(session.subagents.length).toBe(46);
    // This transcript carries 115 `custom-title` entries (the session was renamed repeatedly);
    // the last one is the name Claude Code shows, so it must be the one that survives.
    expect(session.sessionTitle).toBe('Sample text 620');
    expect(session.titleIsCustom).toBe(true);

    const stillWorking = session.subagents.filter((s) => s.status === 'working');
    // Before the fix, detectCompletions() only checked a top-level `tool_use_id` that never
    // exists in real Claude Code transcripts (completions are nested in message.content[]) —
    // so this list stayed at 46 forever, flooding the "Working Agents" group.
    expect(stillWorking).toEqual([]);
  });

  it('parses a genuinely forked worktree session with no subagents like any other session', () => {
    const parser = new LogParser();
    const filePath = path.join(FIXTURES_DIR, 'worktree-fork-session.jsonl');

    const session = parser.parse(filePath, 'claude-code');

    expect(session.gitBranch).toBe('fix/ctx-typed-notifications-await');
    expect(session.subagents.length).toBe(0);
    // The first user turn here carries `message.content` as a plain string (a forked/automated
    // review prompt), and a later `type: "ai-title"` line supersedes it — both must be handled
    // for this forked session to get any distinguishing title in the sidebar at all.
    expect(session.sessionTitle).toBe('Sample text 8');
  });

  it('flags a lone subagent transcript as a sidechain so it is not a phantom top-level session', () => {
    // Claude Code writes each subagent's own full transcript under
    // <sessionId>/subagents/agent-<id>.jsonl, with every entry marked isSidechain:true. The
    // recursive **/*.jsonl file watcher DOES reach these files, so the parser must flag them —
    // getVisibleSessions() drops isSidechain sessions, keeping them from appearing as standalone
    // sessions titled with the subagent's task prompt. Status comes from the parent transcript's
    // tool_use/tool_result pairing instead.
    const parser = new LogParser();
    const filePath = path.join(FIXTURES_DIR, 'nested-subagent-own-transcript.jsonl');

    const session = parser.parse(filePath, 'claude-code');
    expect(session.isSidechain).toBe(true);
  });

  it('flags the lone subagent transcript that surfaced as a phantom session', () => {
    // Captured (user turn + first assistant turn) from a subagent transcript at
    // ~/.claude/projects/<proj>/<sessionId>/subagents/agent-<id>.jsonl that the recursive
    // **/*.jsonl watcher surfaced as a standalone top-level session in the sidebar, titled with
    // the subagent's own task prompt instead of staying nested under its real parent session.
    const parser = new LogParser();
    const filePath = path.join(FIXTURES_DIR, 'phantom-recon-subagent.jsonl');

    const session = parser.parse(filePath, 'claude-code');

    // isSidechain drives the getVisibleSessions() exclusion — without it this reappears as a phantom.
    expect(session.isSidechain).toBe(true);
    // The title comes from the subagent's own task prompt — proof of how the phantom got titled.
    expect(session.sessionTitle).toBe('Sample text 1');
  });

  it('keeps a backgrounded agent working after its async-launch ACK (not instantly completed)', () => {
    // Real parent-transcript entries (task payload redacted): the Agent tool_use, then its
    // tool_result ~115ms later carrying toolUseResult.status === 'async_launched'. That ACK only
    // confirms the launch — this very agent kept running for another ~9 minutes. Before the fix,
    // detectCompletions() treated it as a completion, so every backgrounded subagent jumped
    // straight to "Completed Agents" and nothing ever showed under "Working Agents".
    const parser = new LogParser();
    const filePath = path.join(FIXTURES_DIR, 'async-agent-still-running.jsonl');

    const session = parser.parse(filePath, 'claude-code');

    expect(session.subagents.length).toBe(1);
    expect(session.subagents[0].task).toBe('Sample text 1');
    expect(session.subagents[0].status).toBe('working');
  });

  it('completes a backgrounded agent only when its <task-notification> lands in the parent', () => {
    // Same real capture plus the parent's later <task-notification>, which carries the
    // <tool-use-id> of the spawning Agent call — the key subagents are stored under.
    const parser = new LogParser();
    const filePath = path.join(FIXTURES_DIR, 'async-agent-launch-and-notification.jsonl');

    const session = parser.parse(filePath, 'claude-code');

    expect(session.subagents.length).toBe(1);
    expect(session.subagents[0].status).toBe('stopped');
  });

  describe('SendMessage resume addressed by the sidecar-only agentId', () => {
    // Redacted reconstruction (synthetic ids and text) of a real orchestrating session: an Agent
    // launched with no `name`, backgrounded, completed via <task-notification>, then resumed with
    // SendMessage whose `to` is the raw agentId — an id the parser only learns from the
    // `agent-<id>.meta.json` sidecar under `<sessionId>/subagents/`.
    const fixtureName = 'sendmessage-resume-by-agent-id';
    const agentId = 'a1b2c3d4e5f607182';
    const resumeId = 'toolu_01SampleResume000000001';
    const fixtureLines = fs
      .readFileSync(path.join(FIXTURES_DIR, `${fixtureName}.jsonl`), 'utf8')
      .split('\n')
      .filter((line) => line.trim());
    const sidecar = path.join(FIXTURES_DIR, fixtureName, 'subagents', `agent-${agentId}.meta.json`);
    let tempDir: string | undefined;

    afterEach(() => {
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        tempDir = undefined;
      }
    });

    const toText = (lines: string[]): string => lines.map((line) => line + '\n').join('');

    /** Same layout as the fixture, in a temp dir the test can append to. */
    function copyFixture(lines: string[]): string {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sendmessage-resume-'));
      const subagentsDir = path.join(tempDir, fixtureName, 'subagents');
      fs.mkdirSync(subagentsDir, { recursive: true });
      fs.copyFileSync(sidecar, path.join(subagentsDir, path.basename(sidecar)));
      const filePath = path.join(tempDir, `${fixtureName}.jsonl`);
      fs.writeFileSync(filePath, toText(lines));
      return filePath;
    }

    it('marks the resumed subagent working on a cold full parse (window reload)', () => {
      const session = new LogParser().parse(path.join(FIXTURES_DIR, `${fixtureName}.jsonl`), 'claude-code');

      expect(session.subagents).toHaveLength(1);
      const [resumed] = session.subagents;
      expect(resumed.status).toBe('working');
      expect(resumed.id).toBe(resumeId);
      expect(resumed.launchId).toBe('toolu_01SampleLaunch000000001');
      expect(resumed.agentId).toBe(agentId);
    });

    it('agrees with an incremental parse that already held the agentId', () => {
      const filePath = copyFixture(fixtureLines.slice(0, 5));
      const parser = new LogParser();
      expect(parser.parse(filePath, 'claude-code').subagents[0].status).toBe('stopped');

      fs.appendFileSync(filePath, toText(fixtureLines.slice(5)));
      const session = parser.parse(filePath, 'claude-code');

      expect(session.subagents).toHaveLength(1);
      expect(session.subagents[0].status).toBe('working');
      expect(session.subagents[0].id).toBe(resumeId);
    });

    it('keeps the resumed subagent stopped on a cold parse once the resumed run also completed', () => {
      // The resumed run's own <task-notification> carries the SendMessage's tool_use id (observed
      // on the real session) — so the resume must be applied in line order, before that
      // notification is read, or a cold parse would wrongly revive a finished subagent.
      const completion = {
        type: 'queue-operation',
        operation: 'enqueue',
        timestamp: '2026-10-16T00:04:27.703Z',
        sessionId: fixtureName,
        content: `<task-notification>\n<task-id>${agentId}</task-id>\n<tool-use-id>${resumeId}</tool-use-id>\n<status>completed</status>\n</task-notification>`,
      };
      const filePath = copyFixture([...fixtureLines, JSON.stringify(completion)]);

      const session = new LogParser().parse(filePath, 'claude-code');

      expect(session.subagents).toHaveLength(1);
      expect(session.subagents[0].status).toBe('stopped');
      expect(session.subagents[0].id).toBe(resumeId);
    });
  });
});

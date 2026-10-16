// src/test/progressSync.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyRequests,
  docKey,
  emptyDoc,
  leaseRole,
  listRequests,
  parseDoc,
  parseLease,
  parseRequest,
  readText,
  removeFile,
  writeAtomic,
  LEASE_RENEW_MS,
  LEASE_STALE_MS,
  type ProgressDoc,
} from '../progressSync';
import { freshState } from '../progressRules';

const T = 1_000_000;

function doc(over: Partial<ProgressDoc['state']> = {}, generation = 3): ProgressDoc {
  return { generation, state: { ...freshState(), ...over } };
}

describe('parsing', () => {
  it('reads a doc round trip and falls back to an empty doc for missing, partial or foreign text', () => {
    const d = doc({ totalRuns: 4, pendingToasts: ['century'] });
    expect(parseDoc(JSON.stringify(d))).toEqual(d);
    for (const junk of ['', '{"generation": 2, "state": {', 'null', '[1]', '{"generation": -1}']) {
      expect(parseDoc(junk).state).toEqual(freshState());
    }
    expect(parseDoc('{"generation": 1.5, "state": null}').generation).toBe(0);
  });

  it('reads a lease or null', () => {
    expect(parseLease('{"holder":"a","heartbeat":5}')).toEqual({ holder: 'a', heartbeat: 5 });
    for (const junk of ['', '{"holder":1,"heartbeat":5}', '{"holder":"a"}', 'x']) expect(parseLease(junk)).toBeNull();
  });

  it('reads ack and reset requests, keeping only string ids, and rejects anything else', () => {
    expect(parseRequest('{"kind":"reset","generation":4}')).toEqual({ kind: 'reset', generation: 4 });
    expect(parseRequest('{"kind":"ack","generation":2,"ids":["a",3,"b"]}')).toEqual({
      kind: 'ack',
      generation: 2,
      ids: ['a', 'b'],
    });
    for (const junk of ['', '{"kind":"ack","generation":2}', '{"kind":"wipe","generation":2}', '{"kind":"reset"}']) {
      expect(parseRequest(junk)).toBeNull();
    }
  });
});

describe('leaseRole', () => {
  const lease = (holder: string, heartbeat: number) => ({ holder, heartbeat });
  it('takes a missing lease or one stale for more than 90 s, in either clock direction', () => {
    expect(leaseRole(null, 'me', T)).toBe('take');
    expect(leaseRole(lease('other', T - LEASE_STALE_MS - 1), 'me', T)).toBe('take');
    expect(leaseRole(lease('other', T + LEASE_STALE_MS + 1), 'me', T)).toBe('take');
  });
  it('follows a fresh lease held by another window', () => {
    expect(leaseRole(lease('other', T - LEASE_STALE_MS), 'me', T)).toBe('follow');
  });
  it('holds its own lease and renews it once the heartbeat is 10 s old, even if stale', () => {
    expect(leaseRole(lease('me', T - LEASE_RENEW_MS + 1), 'me', T)).toBe('hold');
    expect(leaseRole(lease('me', T - LEASE_RENEW_MS), 'me', T)).toBe('renew');
    expect(leaseRole(lease('me', T - 10 * LEASE_STALE_MS), 'me', T)).toBe('renew');
  });
});

describe('applyRequests', () => {
  it('clears acknowledged toasts of the same generation only', () => {
    const d = doc({ pendingToasts: ['a', 'b', 'c'] });
    const next = applyRequests(d, [
      { kind: 'ack', generation: 3, ids: ['a'] },
      { kind: 'ack', generation: 2, ids: ['b'] },
    ]);
    expect(next.state.pendingToasts).toEqual(['b', 'c']);
    expect(applyRequests(next, [{ kind: 'ack', generation: 3, ids: ['a'] }]).state.pendingToasts).toEqual(['b', 'c']);
  });

  it('resets to the newest requested generation, once, and drops acks of the old generation', () => {
    const d = doc({ totalRuns: 9, pendingToasts: ['a'] });
    const next = applyRequests(d, [
      { kind: 'reset', generation: 4 },
      { kind: 'ack', generation: 3, ids: ['a'] },
      { kind: 'reset', generation: 4 },
    ]);
    expect(next).toEqual({ generation: 4, state: freshState() });
    expect(applyRequests(next, [{ kind: 'reset', generation: 4 }])).toBe(next);
    expect(applyRequests(d, [{ kind: 'reset', generation: 2 }])).toBe(d);
  });
});

describe('docKey', () => {
  it('ignores per-tick bookkeeping but not progress, generation or pausing', () => {
    const d = doc({ lastTickAt: 1, prevWorking: ['x'], dayMs: 5, peak: 1 });
    expect(docKey({ ...d, state: { ...d.state, lastTickAt: 2, prevWorking: [], dayMs: 9, peak: 3 } })).toBe(docKey(d));
    expect(docKey({ ...d, state: { ...d.state, lastTickAt: null } })).not.toBe(docKey(d));
    expect(docKey({ ...d, generation: 4 })).not.toBe(docKey(d));
    expect(docKey({ ...d, state: { ...d.state, countedIds: ['r'] } })).not.toBe(docKey(d));
    expect(docKey({ ...d, state: { ...d.state, pendingToasts: ['century'] } })).not.toBe(docKey(d));
    expect(docKey({ ...d, state: { ...d.state, types: { t: { workMs: 1, runs: 0 } } } })).not.toBe(docKey(d));
  });
});

describe('file helpers', () => {
  let dir = '';
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });
  const tmp = () => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentville-sync-')));

  it('writes atomically, leaves no temp file, and reads back', () => {
    const file = path.join(tmp(), 'progress.json');
    expect(writeAtomic(file, JSON.stringify(emptyDoc()), 'w1')).toBe(true);
    expect(writeAtomic(file, '{"generation":1}', 'w1')).toBe(true);
    expect(readText(file)).toBe('{"generation":1}');
    expect(fs.readdirSync(dir)).toEqual(['progress.json']);
  });

  it("reads '' for a missing file and null for an unreadable one, without throwing", () => {
    expect(readText(path.join(tmp(), 'missing.json'))).toBe('');
    expect(readText(dir)).toBeNull(); // a directory: EISDIR
  });

  it('reports a failed write and cleans up', () => {
    expect(writeAtomic(path.join(tmp(), 'no', 'such', 'dir.json'), '{}', 'w1')).toBe(false);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('lists only finished request files and removes files quietly', () => {
    tmp();
    for (const name of ['req-a-1-1.json', 'req-a-1-2.json.a.tmp', 'progress.json', 'lease.json']) {
      fs.writeFileSync(path.join(dir, name), '{}');
    }
    expect(listRequests(dir)).toEqual(['req-a-1-1.json']);
    removeFile(path.join(dir, 'req-a-1-1.json'));
    removeFile(path.join(dir, 'gone.json'));
    expect(listRequests(dir)).toEqual([]);
    expect(listRequests(path.join(dir, 'missing'))).toEqual([]);
  });
});

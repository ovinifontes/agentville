// src/test/progressSync.test.ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  applyRequests,
  cleanStaleTemps,
  docKey,
  emptyDoc,
  fileSignature,
  leaseRole,
  listRequests,
  loadForHolder,
  parseLease,
  parseRequest,
  readDoc,
  readText,
  removeFile,
  saveDoc,
  writeAtomic,
  LEASE_RENEW_MS,
  LEASE_STALE_MS,
  STALE_TEMP_MS,
  type ProgressDoc,
} from '../progressSync';
import { freshState, SCHEMA_VERSION } from '../progressRules';

const T = 1_000_000;

function doc(over: Partial<ProgressDoc['state']> = {}, generation = 3): ProgressDoc {
  return { generation, state: { ...freshState(), ...over } };
}

describe('parsing', () => {
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

describe('progress file (rulings R7, R12)', () => {
  let dir = '';
  let file = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentville-doc-'));
    file = path.join(dir, 'progress.json');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const put = (name: string, text: string) => {
    fs.writeFileSync(path.join(dir, name), text);
  };
  const good = (generation: number, totalRuns = 0) => JSON.stringify(doc({ totalRuns }, generation));
  const INVALID = [
    '',
    '{"generation": 2, "state": {',
    '{}',
    '[]',
    'null',
    '{"generation": -1, "state": {"version": 1}}',
    '{"generation": 1}',
    '{"generation": 1, "state": {}}',
    '{"generation": 1, "state": {"version": 0}}',
  ];

  it('reads a valid doc, sanitised by migrate', () => {
    put('progress.json', JSON.stringify({ generation: 2, state: { version: SCHEMA_VERSION, totalRuns: 4, types: 7 } }));
    expect(readDoc(file)).toEqual({ generation: 2, state: { ...freshState(), totalRuns: 4 } });
  });

  it('is missing only when neither the file nor its backup exists', () => {
    expect(readDoc(file)).toBe('missing');
    put('progress.json.bak', good(1, 5));
    expect(readDoc(file)).toEqual(doc({ totalRuns: 5 }, 1));
  });

  it('treats any existing non-doc content as invalid and falls back to the backup', () => {
    for (const text of INVALID) {
      put('progress.json', text);
      fs.rmSync(`${file}.bak`, { force: true });
      expect(readDoc(file)).toBe('invalid');
      put('progress.json.bak', good(2, 7));
      expect(readDoc(file)).toEqual(doc({ totalRuns: 7 }, 2));
    }
  });

  it('reports a newer schema without migrating it, and an unreadable file as an error', () => {
    put('progress.json', JSON.stringify({ generation: 1, state: { version: SCHEMA_VERSION + 1 } }));
    put('progress.json.bak', good(1, 3));
    expect(readDoc(file)).toBe('newer');
    expect(loadForHolder(file, T)).toBeNull();
    expect(saveDoc(file, doc(), 'w1')).toBeNull();
    fs.rmSync(file);
    fs.mkdirSync(file); // a directory: EISDIR
    expect(readDoc(file)).toBe('error');
    expect(loadForHolder(file, T)).toBeNull();
    expect(saveDoc(file, doc(), 'w1')).toBeNull();
  });

  it('a holder starts fresh when there is no file, or when both are invalid, keeping the bad file aside', () => {
    expect(loadForHolder(file, T)).toEqual(emptyDoc());
    put('progress.json', '{"generation": 3, "st');
    put('progress.json.bak', '');
    expect(loadForHolder(file, T)).toEqual(emptyDoc());
    expect(fs.readFileSync(`${file}.corrupt-${String(T)}`, 'utf8')).toBe('{"generation": 3, "st');
    expect(fs.existsSync(file)).toBe(false);
  });

  it('a holder starts from the backup when only the file is invalid, without moving anything', () => {
    put('progress.json', '{}');
    put('progress.json.bak', good(4, 9));
    expect(loadForHolder(file, T)).toEqual(doc({ totalRuns: 9 }, 4));
    expect(fs.readdirSync(dir).sort()).toEqual(['progress.json', 'progress.json.bak']);
  });

  it('saves after copying the last good file to the backup', () => {
    expect(saveDoc(file, doc({ totalRuns: 1 }, 1), 'w1')).toEqual(doc({ totalRuns: 1 }, 1));
    expect(fs.existsSync(`${file}.bak`)).toBe(false);
    expect(saveDoc(file, doc({ totalRuns: 2 }, 1), 'w1')).toEqual(doc({ totalRuns: 2 }, 1));
    expect(readDoc(file)).toEqual(doc({ totalRuns: 2 }, 1));
    expect(readDoc(`${file}.bak`)).toEqual(doc({ totalRuns: 1 }, 1));
    // An invalid file is replaced without overwriting the good backup.
    put('progress.json', '');
    expect(saveDoc(file, doc({ totalRuns: 3 }, 1), 'w1')).not.toBeNull();
    expect(readDoc(`${file}.bak`)).toEqual(doc({ totalRuns: 1 }, 1));
    expect(fs.readdirSync(dir).sort()).toEqual(['progress.json', 'progress.json.bak']);
  });

  it('a newer generation on disk, or in the backup, wins over memory and is not overwritten', () => {
    put('progress.json', good(5, 0));
    expect(saveDoc(file, doc({ totalRuns: 8 }, 4), 'w1')).toEqual(doc({}, 5));
    put('progress.json', 'garbage');
    put('progress.json.bak', good(6, 0));
    expect(saveDoc(file, doc({ totalRuns: 8 }, 4), 'w1')).toEqual(doc({}, 6));
    expect(fs.readFileSync(file, 'utf8')).toBe('garbage');
  });

  it('reports a failed write as null', () => {
    expect(saveDoc(path.join(dir, 'no', 'progress.json'), doc(), 'w1')).toBeNull();
  });

  it('signs a file so a replacement is noticed, and null when missing', () => {
    expect(fileSignature(file)).toBeNull();
    writeAtomic(file, good(1), 'w1');
    const first = fileSignature(file);
    expect(first).not.toBeNull();
    expect(fileSignature(file)).toBe(first);
    writeAtomic(file, good(1), 'w1');
    expect(fileSignature(file)).not.toBe(first);
  });

  it('cleans only temp files older than a minute', () => {
    const now = Date.now();
    for (const name of ['progress.json.a.tmp', 'lease.json.b.tmp', 'progress.json', 'req-x-1-1.json']) put(name, '{}');
    const old = new Date(now - STALE_TEMP_MS - 1000);
    for (const name of ['progress.json.a.tmp', 'progress.json', 'req-x-1-1.json']) {
      fs.utimesSync(path.join(dir, name), old, old);
    }
    cleanStaleTemps(dir, now);
    expect(fs.readdirSync(dir).sort()).toEqual(['lease.json.b.tmp', 'progress.json', 'req-x-1-1.json']);
    cleanStaleTemps(path.join(dir, 'missing'), now); // never throws
  });
});

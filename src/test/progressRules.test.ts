// src/test/progressRules.test.ts
import { describe, it, expect } from 'vitest';
import {
  applyTick,
  freshState,
  levelFor,
  xpForLevel,
  officeXp,
  unlockedDecor,
  rankTypes,
  migrate,
  MAX_COUNTED_IDS,
  type ProgressState,
} from '../progressRules';
import type { Session, SubAgent } from '../types';

const MIN = 60_000;
// 2026-03-10 12:00 UTC; tz offset 0 unless stated.
const T0 = Date.UTC(2026, 2, 10, 12, 0, 0);

function sub(over: Partial<SubAgent> = {}): SubAgent {
  return { id: 'a1', name: 'Explorer ', task: 't', status: 'working', ...over };
}
function sess(subagents: SubAgent[] = [], over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    projectHash: 'h',
    projectPath: '/p',
    projectName: 'p',
    gitBranch: 'main',
    status: 'stopped',
    lastInteractionTime: 0,
    subagents,
    logFilePath: '/p/s1.jsonl',
    type: 'claude-code',
    ...over,
  };
}
const clock = (now: number, tz = 0) => ({ now, tzOffsetMinutes: tz });

// A state that already ticked once (empty office), so later stopped runs are genuinely new.
const warm = (): ProgressState => applyTick(freshState(), [], clock(T0 - MIN)).state;

function run(sessions: Session[], times: number[], opts: { from?: ProgressState; tz?: number } = {}) {
  return times.reduce((st, t) => applyTick(st, sessions, clock(t, opts.tz)).state, opts.from ?? warm());
}

describe('levels', () => {
  it('xpForLevel follows 25*n*(n-1)', () => {
    expect([1, 2, 3, 5, 10].map(xpForLevel)).toEqual([0, 50, 150, 500, 2250]);
  });
  it('levelFor flips exactly at thresholds', () => {
    expect([0, 49, 50, 149, 150, 499, 500, 2249, 2250].map(levelFor)).toEqual([1, 1, 2, 2, 3, 4, 5, 9, 10]);
  });
});

describe('decoration and office xp', () => {
  it('unlocks items at 100/300/600/1000/1500/2200/3000/4000', () => {
    const at = [0, 99, 100, 299, 300, 599, 600, 999, 1000, 1499, 1500, 2199, 2200, 2999, 3000, 3999, 4000, 99999];
    expect(at.map(unlockedDecor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8]);
  });
  it('officeXp sums all types', () => {
    const st = run([sess([sub({ status: 'stopped' })], { status: 'working' })], [T0, T0 + MIN]);
    expect(officeXp(st)).toBe(11); // 1 min session + 10 run
  });
});

describe('applyTick accrual', () => {
  const working = [sess([], { status: 'working' })];
  it('first tick credits nothing', () => {
    expect(run(working, [T0], { from: freshState() }).types).toEqual({});
  });
  it('credits elapsed time to the agent type on the second tick', () => {
    const st = run(working, [T0, T0 + 30_000]);
    expect(st.types.session.workMs).toBe(30_000);
  });
  it('caps one credit at 60 s', () => {
    const st = run(working, [T0, T0 + 10 * MIN]);
    expect(st.types.session.workMs).toBe(MIN);
  });
  it('does not credit an agent that was not working at the previous tick', () => {
    const idle = [sess([], { status: 'stopped' })];
    const st = applyTick(run(idle, [T0]), working, clock(T0 + MIN)).state;
    expect(st.types).toEqual({});
  });
  it('fractional time accumulates to full XP minutes', () => {
    const st = run(working, [T0, T0 + 30_000, T0 + 60_000]);
    expect(officeXp(st)).toBe(1);
  });
  it('types are lowercased/trimmed; background and grandchild get their own types', () => {
    const tree = [
      sess(
        [
          sub({ children: [sub({ id: 'g1', name: 'Reviewer' })] }),
          sub({ id: 'b1', name: 'Agent', transcriptPath: '/x' }),
        ],
        {
          status: 'working',
        },
      ),
    ];
    const st = run(tree, [T0, T0 + MIN]);
    expect(Object.keys(st.types).sort()).toEqual(['background agent', 'explorer', 'reviewer', 'session']);
  });
  it('tolerates a type named __proto__', () => {
    const st = run([sess([sub({ name: '__proto__' })])], [T0, T0 + MIN]);
    expect(Object.hasOwn(st.types, '__proto__')).toBe(true);
  });
});

describe('completed runs', () => {
  const done = (id: string, name = 'explorer', extra: Partial<SubAgent> = {}) =>
    sub({ id, name, status: 'stopped', ...extra });
  it('+10 XP, runs+1, once per id', () => {
    const s = [sess([done('a')])];
    const st = run(s, [T0, T0 + MIN, T0 + 2 * MIN]);
    expect(st.types.explorer).toEqual({ workMs: 0, runs: 1 });
    expect(st.totalRuns).toBe(1);
  });
  it('counts grandchildren and ignores top-level sessions', () => {
    const s = [sess([sub({ children: [done('g')] })], { status: 'stopped' })];
    const st = run(s, [T0]);
    expect(st.types.explorer.runs).toBe(1);
    expect(st.types.session).toBeUndefined();
  });
  it('bounded set keeps latest 2000 ids, dropping the oldest', () => {
    const many = Array.from({ length: MAX_COUNTED_IDS + 5 }, (_, i) => done(`r${i}`));
    const st = run([sess(many)], [T0]);
    expect(st.countedIds).toHaveLength(MAX_COUNTED_IDS);
    expect(st.countedIds[0]).toBe('r5');
    expect(st.totalRuns).toBe(MAX_COUNTED_IDS + 5);
  });
  it('a dropped (oldest) id would count again, a retained one never', () => {
    const many = Array.from({ length: MAX_COUNTED_IDS + 1 }, (_, i) => done(`r${i}`));
    const st = run([sess(many)], [T0]);
    const again = applyTick(st, [sess([done('r1000')])], clock(T0 + MIN)).state;
    expect(again.totalRuns).toBe(st.totalRuns);
  });
  it('duplicate ids within one tick count once', () => {
    const st = run([sess([done('d'), done('d')])], [T0]);
    expect(st.totalRuns).toBe(1);
  });
});

describe('first tick seeding (R3)', () => {
  const done = (id: string, name = 'explorer') => sub({ id, name, status: 'stopped' });
  it('records history as counted without XP, runs or achievements', () => {
    const r = applyTick(freshState(), [sess([done('a'), done('b', 'x'), done('c', 'y')])], clock(T0));
    expect(officeXp(r.state)).toBe(0);
    expect(r.state.totalRuns).toBe(0);
    expect(r.unlocked).toEqual([]);
    expect(r.state.countedIds).toEqual(['a', 'b', 'c']);
    const next = applyTick(r.state, [sess([done('a'), done('n')])], clock(T0 + MIN));
    expect(next.state.types.explorer.runs).toBe(1);
    expect(officeXp(next.state)).toBe(10);
    expect(next.unlocked).toEqual(['first-hire']);
  });
  it('a counted run resumed and completed again earns once', () => {
    const states = [done('a'), sub({ id: 'a' }), done('a'), sub({ id: 'a' }), done('a')];
    let st = run([sess([done('a')])], [T0], { from: freshState() });
    for (const [i, a] of states.entries()) st = applyTick(st, [sess([a])], clock(T0 + (i + 1) * MIN)).state;
    expect(st.totalRuns).toBe(0);
    let st2 = warm();
    for (const [i, a] of states.entries()) st2 = applyTick(st2, [sess([a])], clock(T0 + (i + 1) * MIN)).state;
    expect(st2.totalRuns).toBe(1);
  });
});

describe('purity and nesting', () => {
  it('does not mutate its input state', () => {
    const st = run([sess([sub({ status: 'stopped' })], { status: 'working' })], [T0, T0 + MIN]);
    const before = structuredClone(st);
    applyTick(st, [sess([sub({ id: 'z', status: 'stopped' })], { status: 'working' })], clock(T0 + 2 * MIN));
    expect(st).toEqual(before);
  });
  it('types a nested background agent grandchild as background agent', () => {
    const tree = sess([sub({ children: [sub({ id: 'bg', name: 'Agent', transcriptPath: '/t' })] })]);
    const st = run([tree], [T0, T0 + MIN]);
    expect(Object.keys(st.types)).toContain('background agent');
    expect(Object.keys(st.types)).not.toContain('agent');
  });
});

describe('day tracking', () => {
  const working = [sess([], { status: 'working' })];
  it('resets the day total at local midnight (offset 180 = UTC-3)', () => {
    // 02:59:30 UTC = 23:59:30 local the day before; 03:00:30 UTC = 00:00:30 local.
    const a = Date.UTC(2026, 2, 10, 2, 59, 30);
    const before = run(working, [a - 30_000, a], { from: freshState(), tz: 180 });
    expect(before.dayKey).toBe('2026-03-09');
    expect(before.dayMs).toBe(30_000);
    const after = applyTick(before, working, clock(a + 60_000, 180)).state;
    expect(after.dayKey).toBe('2026-03-10');
    expect(after.dayMs).toBe(60_000); // yesterday's 30 s dropped; only the new credit remains
  });
});

describe('migrate', () => {
  it('returns fresh state for junk and never throws', () => {
    for (const junk of [null, undefined, 5, 'x', [], {}, { version: 99 }]) {
      expect(migrate(junk)).toEqual(freshState());
    }
  });
  it('round-trips a valid state through JSON', () => {
    const st = run([sess([sub({ status: 'stopped' })], { status: 'working' })], [T0, T0 + MIN]);
    expect(migrate(JSON.parse(JSON.stringify(st)))).toEqual(st);
  });
  it('sanitises bad fields', () => {
    const m = migrate({
      version: 1,
      types: { a: { workMs: 'x', runs: -3 }, b: 7 },
      countedIds: [1, 'k'],
      achievements: { x: 'no' },
    });
    expect(m.types).toEqual({ a: { workMs: 0, runs: 0 } });
    expect(m.countedIds).toEqual(['k']);
    expect(m.achievements).toEqual({});
  });
});

describe('rankTypes', () => {
  it('orders by XP desc then type name', () => {
    const st: ProgressState = {
      ...freshState(),
      types: {
        zeta: { workMs: 0, runs: 2 },
        alpha: { workMs: 0, runs: 2 },
        top: { workMs: 0, runs: 9 },
        low: { workMs: 0, runs: 1 },
      },
    };
    expect(rankTypes(st).map((r) => r.type)).toEqual(['top', 'alpha', 'zeta', 'low']);
    expect(rankTypes(st)[0]).toMatchObject({ xp: 90, level: 2, runs: 9 });
  });
});

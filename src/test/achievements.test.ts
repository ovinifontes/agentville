// src/test/achievements.test.ts
import { describe, it, expect } from 'vitest';
import { ACHIEVEMENTS } from '../achievements';
import { applyTick, freshState, type ProgressState } from '../progressRules';
import type { Session, SubAgent } from '../types';

const MIN = 60_000;
const at = (h: number, m = 0) => Date.UTC(2026, 2, 10, h, m, 0);

const sub = (id: string, name: string, stopped = false): SubAgent => ({
  id,
  name,
  task: 't',
  status: stopped ? 'stopped' : 'working',
});
const sess = (subagents: SubAgent[], status: Session['status'] = 'stopped'): Session => ({
  id: 's1',
  projectHash: 'h',
  projectPath: '/p',
  projectName: 'p',
  gitBranch: 'main',
  status,
  lastInteractionTime: 0,
  subagents,
  logFilePath: '/p/s1.jsonl',
  type: 'claude-code',
});
// Already ticked once (empty office): the first tick only seeds history (R3).
const fresh = (): ProgressState => applyTick(freshState(), [], { now: at(11), tzOffsetMinutes: 0 }).state;
const tick = (st: ProgressState, s: Session[], now: number) => applyTick(st, s, { now, tzOffsetMinutes: 0 });
const stoppedN = (n: number, prefix = 'r', name = 'explorer') =>
  Array.from({ length: n }, (_, i) => sub(`${prefix}${i}`, name, true));

describe('achievements', () => {
  it('defines the eight G5 ids', () => {
    expect(ACHIEVEMENTS.map((a) => a.id)).toEqual([
      'first-hire',
      'team-player',
      'full-house',
      'night-owl',
      'early-bird',
      'marathon',
      'century',
      'veteran',
    ]);
  });

  it('first hire: none with a working subagent, unlocks on first completed run', () => {
    expect(tick(fresh(), [sess([sub('a', 'x')])], at(12)).unlocked).toEqual([]);
    const r = tick(fresh(), [sess([sub('a', 'x', true)])], at(12));
    expect(r.unlocked).toEqual(['first-hire']);
    expect(r.state.achievements['first-hire']).toBe(at(12));
    expect(r.state.pendingToasts).toEqual(['first-hire']);
  });

  it('is unlocked once only', () => {
    const s = [sess([sub('a', 'x', true)])];
    const r1 = tick(fresh(), s, at(12));
    const r2 = tick(r1.state, [sess([sub('a', 'x', true), sub('b', 'y', true)])], at(12, 1));
    expect(r2.unlocked).toEqual([]);
    expect(r2.state.pendingToasts).toEqual(['first-hire']);
    expect(r2.state.achievements['first-hire']).toBe(at(12));
  });

  it('team player: 4 distinct types no, 5 yes (same type repeated does not count)', () => {
    const four = ['a', 'b', 'c', 'd'].map((n) => sub(n, n, true));
    const r4 = tick(fresh(), [sess([...four, sub('a2', 'a', true)])], at(12));
    expect(r4.unlocked).not.toContain('team-player');
    const r5 = tick(r4.state, [sess([...four, sub('e', 'e', true)])], at(12, 1));
    expect(r5.unlocked).toEqual(['team-player']);
  });

  it('full house: 5 concurrent no, 6 yes (grandchildren count)', () => {
    const five = ['a', 'b', 'c', 'd'].map((n) => sub(n, n));
    five.push({ ...sub('e', 'e'), children: [] });
    const r5 = tick(fresh(), [sess(five)], at(12));
    expect(r5.unlocked).not.toContain('full-house');
    five[4] = { ...five[4], children: [sub('g', 'g')] };
    const r6 = tick(r5.state, [sess(five)], at(12, 1));
    expect(r6.unlocked).toContain('full-house');
    expect(r6.state.peak).toBe(6);
  });

  it('night owl: 04:59 yes, 05:00 no; needs a working agent', () => {
    const w = [sess([], 'working')];
    expect(tick(fresh(), w, at(4, 59)).unlocked).toEqual(['night-owl']);
    expect(tick(fresh(), w, at(5, 0)).unlocked).toEqual(['early-bird']);
    expect(tick(fresh(), [sess([])], at(3)).unlocked).toEqual([]);
    expect(tick(fresh(), w, at(0, 0)).unlocked).toEqual(['night-owl']);
  });

  it('early bird: 06:59 yes, 07:00 no', () => {
    const w = [sess([], 'working')];
    expect(tick(fresh(), w, at(6, 59)).unlocked).toEqual(['early-bird']);
    expect(tick(fresh(), w, at(7, 0)).unlocked).toEqual([]);
  });

  it('hour uses the local offset (UTC-3: 07:30 UTC is 04:30 local)', () => {
    expect(applyTick(freshState(), [sess([], 'working')], { now: at(7, 30), tzOffsetMinutes: 180 }).unlocked).toEqual([
      'night-owl',
    ]);
  });

  it('marathon: 119 vs 120 working minutes in one day', () => {
    const w = [sess([], 'working')];
    let st = freshState();
    for (let i = 0; i <= 119; i++) st = tick(st, w, at(12) + i * MIN).state; // 119 credited minutes
    expect(st.achievements.marathon).toBeUndefined();
    const r = tick(st, w, at(12) + 120 * MIN);
    expect(r.unlocked).toEqual(['marathon']);
  });

  it('marathon sums across agents', () => {
    const w = [sess([sub('a', 'x'), sub('b', 'y')], 'working')]; // 3 agents
    let st = freshState();
    for (let i = 0; i <= 40; i++) st = tick(st, w, at(12) + i * MIN).state;
    expect(st.achievements.marathon).toBe(at(12) + 40 * MIN);
  });

  it('century: 99 runs no, 100 yes', () => {
    const r99 = tick(fresh(), [sess(stoppedN(99))], at(12));
    expect(r99.unlocked).not.toContain('century');
    const r100 = tick(r99.state, [sess(stoppedN(100))], at(12, 1));
    expect(r100.unlocked).toEqual(['century']);
  });

  it('veteran: level 4 (499 XP) no, level 5 (500 XP) yes', () => {
    const base = { ...freshState(), types: { explorer: { workMs: 0, runs: 49 } }, totalRuns: 49 };
    const r49 = tick(base, [sess([])], at(12));
    expect(r49.unlocked).not.toContain('veteran');
    const r50 = tick({ ...base, types: { explorer: { workMs: 9 * MIN, runs: 49 } } }, [sess([])], at(12));
    expect(r50.unlocked).not.toContain('veteran'); // 499
    const r500 = tick({ ...base, types: { explorer: { workMs: 10 * MIN, runs: 49 } } }, [sess([])], at(12));
    expect(r500.unlocked).toContain('veteran'); // 500
  });
});

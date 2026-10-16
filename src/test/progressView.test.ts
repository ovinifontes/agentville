// src/test/progressView.test.ts
import { describe, it, expect } from 'vitest';
import { toProgressView } from '../progressView';
import { freshState, type ProgressState } from '../progressRules';
import { ACHIEVEMENTS } from '../achievements';

const MIN = 60_000;

function state(over: Partial<ProgressState> = {}): ProgressState {
  return { ...freshState(), ...over };
}

describe('toProgressView', () => {
  it('is empty and flagged when progression is disabled', () => {
    const busy = state({ types: { explorer: { workMs: 500 * MIN, runs: 3 } }, pendingToasts: ['first-hire'] });
    expect(toProgressView(busy, false)).toEqual({
      enabled: false,
      officeXp: 0,
      nextDecorXp: null,
      decor: [],
      rows: [],
      achievements: [],
      toasts: [],
    });
  });

  it('starts at zero with the first decoration threshold ahead and every achievement locked', () => {
    const view = toProgressView(freshState(), true);
    expect(view).toMatchObject({ enabled: true, officeXp: 0, nextDecorXp: 100, decor: [], rows: [], toasts: [] });
    expect(view.achievements.map((a) => a.id)).toEqual(ACHIEVEMENTS.map((a) => a.id));
    expect(view.achievements.every((a) => !('unlockedAt' in a))).toBe(true);
  });

  it('ranks rows with level and the XP where the next level starts', () => {
    const view = toProgressView(
      state({ types: { explorer: { workMs: 40 * MIN, runs: 1 }, session: { workMs: 160 * MIN, runs: 0 } } }),
      true,
    );
    expect(view.rows).toEqual([
      { type: 'session', xp: 160, level: 3, nextLevelXp: 300, runs: 0, workMs: 160 * MIN },
      { type: 'explorer', xp: 50, level: 2, nextLevelXp: 150, runs: 1, workMs: 40 * MIN },
    ]);
    expect(view.officeXp).toBe(210);
  });

  it('unlocks decoration ids in order and reports the next threshold, null once all are unlocked', () => {
    const at = (xp: number) => toProgressView(state({ types: { t: { workMs: xp * MIN, runs: 0 } } }), true);
    expect(at(300)).toMatchObject({ decor: [0, 1], nextDecorXp: 600 });
    expect(at(4000)).toMatchObject({ decor: [0, 1, 2, 3, 4, 5, 6, 7], nextDecorXp: null });
  });

  it('stamps unlocked achievements with their time', () => {
    const view = toProgressView(state({ achievements: { 'night-owl': 1234 } }), true);
    const owl = view.achievements.find((a) => a.id === 'night-owl');
    expect(owl).toEqual({ id: 'night-owl', title: 'Night owl', description: expect.any(String), unlockedAt: 1234 });
  });

  it('toasts each known pending achievement once, in unlock order', () => {
    const view = toProgressView(state({ pendingToasts: ['century', 'bogus', 'first-hire', 'century'] }), true);
    expect(view.toasts).toEqual(['century', 'first-hire']);
  });
});

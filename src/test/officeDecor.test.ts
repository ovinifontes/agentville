import { describe, expect, it } from 'vitest';
import { DECOR_SLOTS, visibleDecor } from '../webview/simulation/decor';
import { tileAt, walkableTiles } from '../webview/simulation/world';

describe('decor slots', () => {
  it('has one slot per id, each on a wall tile, all distinct', () => {
    expect(DECOR_SLOTS.map((s) => s.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const s of DECOR_SLOTS) {
      expect(tileAt(s.tx, s.ty)).toBe('#');
    }
    expect(new Set(DECOR_SLOTS.map((s) => `${s.tx},${s.ty}`)).size).toBe(8);
  });

  it('hangs the clock above more wall', () => {
    const clock = DECOR_SLOTS[0];
    expect(tileAt(clock.tx, clock.ty + 1)).toBe('#');
  });

  it('never changes walkability', () => {
    const before = JSON.stringify(walkableTiles());
    visibleDecor([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(JSON.stringify(walkableTiles())).toBe(before);
  });

  it('returns only unlocked ids and ignores unknown ones', () => {
    expect(visibleDecor([]).length).toBe(0);
    expect(visibleDecor([2, 0, 99, -1]).map((s) => s.id)).toEqual([0, 2]);
  });
});

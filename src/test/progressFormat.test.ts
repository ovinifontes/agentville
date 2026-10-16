import { describe, expect, it } from 'vitest';
import { formatDuration, levelPercent, tagText } from '../webview/ui/progressFormat';

describe('tagText', () => {
  it('appends the level and truncates only the name', () => {
    expect(tagText('reader', 3)).toBe('reader · Lv 3');
    expect(tagText('a'.repeat(30), 12)).toBe(`${'a'.repeat(18)}… · Lv 12`);
  });
  it('shows just the name without a level', () => {
    expect(tagText('reader', undefined)).toBe('reader');
    expect(tagText('reader', 1)).toBe('reader');
  });
});

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(-5)).toBe('0s');
    expect(formatDuration(45_000)).toBe('45s');
    expect(formatDuration(12 * 60_000 + 59_000)).toBe('12m');
    expect(formatDuration(125 * 60_000)).toBe('2h 05m');
  });
});

describe('levelPercent', () => {
  it('measures progress inside the current level', () => {
    // level 2 spans 50..150
    expect(levelPercent(50, 2, 150)).toBe(0);
    expect(levelPercent(100, 2, 150)).toBe(50);
    expect(levelPercent(999, 2, 150)).toBe(100);
    expect(levelPercent(0, 2, 150)).toBe(0);
  });
  it('is full for a degenerate span', () => {
    expect(levelPercent(10, 2, 50)).toBe(100);
  });
});

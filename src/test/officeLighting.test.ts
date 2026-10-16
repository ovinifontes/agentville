import { describe, expect, it } from 'vitest';
import { lightingAt, NIGHT } from '../webview/simulation/lighting';

const at = (h: number, m = 0) => lightingAt(h * 60 + m);

describe('lightingAt', () => {
  it('is untinted and dark-screened by day', () => {
    for (const h of [7, 9, 12, 16, 17]) {
      expect(at(h)).toMatchObject({ alpha: 0, screensGlow: 0 });
    }
  });

  it('warms through dusk, then blues through the evening', () => {
    expect(at(18).alpha).toBeCloseTo(0.3);
    expect(at(18).color).toBe(0xff9a3c);
    expect(at(19)).toMatchObject({ alpha: 0.6, color: 0xff9a3c });
    expect(at(20).alpha).toBeCloseTo(0.8);
    expect(at(20).color & 0xff).toBeGreaterThan(0x3c); // blue channel rising
    expect(at(21)).toMatchObject({ alpha: 1, color: NIGHT, screensGlow: 1 });
  });

  it('stays dark blue and glowing from 21:00 to 05:00, across midnight', () => {
    for (const [h, m] of [
      [21, 0],
      [23, 0],
      [0, 0],
      [2, 30],
      [5, 0],
    ]) {
      expect(at(h, m)).toEqual({ color: NIGHT, alpha: 1, screensGlow: 1 });
    }
  });

  it('fades back through dawn', () => {
    expect(at(6).alpha).toBeCloseTo(0.5);
    expect(at(6).screensGlow).toBeCloseTo(0.5);
    expect(at(7).alpha).toBe(0);
  });

  it('never gets darker than the night colour and wraps out-of-range minutes', () => {
    for (let m = 0; m < 1440; m++) {
      const { color, alpha, screensGlow } = lightingAt(m);
      expect(alpha).toBeLessThanOrEqual(1);
      // Effective multiplier per channel: the colour faded towards white by (1 - alpha).
      const floor = Math.min(color >> 16, (color >> 8) & 0xff, color & 0xff);
      expect(255 * (1 - alpha) + floor * alpha).toBeGreaterThanOrEqual(0x4a - 1);
      expect(screensGlow).toBeGreaterThanOrEqual(0);
      expect(screensGlow).toBeLessThanOrEqual(1);
    }
    expect(lightingAt(1440 + 12 * 60)).toEqual(at(12));
    expect(lightingAt(-60)).toEqual(at(23));
  });

  it('is continuous at every window boundary and every minute', () => {
    for (let m = 0; m < 1440; m++) {
      const a = lightingAt(m);
      const b = lightingAt(m + 1);
      expect(Math.abs(a.alpha - b.alpha)).toBeLessThan(0.01);
      expect(Math.abs(a.screensGlow - b.screensGlow)).toBeLessThan(0.02);
    }
    for (const h of [5, 7, 17, 19, 21]) {
      const before = lightingAt(h * 60 - 0.001);
      const after = lightingAt(h * 60);
      expect(Math.abs(before.alpha - after.alpha)).toBeLessThan(1e-3);
      expect(Math.abs(before.screensGlow - after.screensGlow)).toBeLessThan(1e-3);
    }
  });
});

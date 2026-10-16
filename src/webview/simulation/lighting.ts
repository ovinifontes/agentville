// Day/night tint (spec G7). Pure: the caller supplies the local minute of the day, so the
// curve is testable without a clock, a browser or Phaser.

export interface Lighting {
  /** Overlay colour, 0xRRGGBB. */
  color: number;
  /** Overlay opacity, 0..MAX_ALPHA: low enough that characters stay readable. */
  alpha: number;
  /** Desk-monitor glow strength, 0..1. */
  screensGlow: number;
}

const MINUTES_PER_DAY = 1440;
export const MAX_ALPHA = 0.4;
const WARM = 0xff9a3c;
const NIGHT = 0x0b1a4a;

type Key = readonly [minute: number, color: number, alpha: number, glow: number];

// Linear between keys. Night runs past midnight, so the last key repeats dawn's start a day later.
// Day is a transparent warm tint, so dusk rises from it and dawn fades back into it.
const KEYS: readonly Key[] = [
  [5 * 60, NIGHT, MAX_ALPHA, 1], // night ends, dawn starts
  [7 * 60, WARM, 0, 0], // day
  [17 * 60, WARM, 0, 0], // dusk starts
  [19 * 60, WARM, 0.18, 0.3], // evening starts, turning blue
  [21 * 60, NIGHT, MAX_ALPHA, 1], // night
  [29 * 60, NIGHT, MAX_ALPHA, 1], // 05:00 next day
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function lerpColor(a: number, b: number, t: number): number {
  // Shift 16, 8, 0 pick the red, green and blue channels.
  return [16, 8, 0].reduce((out, shift) => {
    const channel = Math.round(lerp((a >> shift) & 0xff, (b >> shift) & 0xff, t));
    return out | (channel << shift);
  }, 0);
}

export function lightingAt(minutesSinceMidnight: number): Lighting {
  const wrapped = ((minutesSinceMidnight % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const minute = wrapped < KEYS[0][0] ? wrapped + MINUTES_PER_DAY : wrapped;
  const next = KEYS.findIndex(([at]) => at >= minute);
  const [m0, c0, a0, g0] = KEYS[next - 1] ?? KEYS[0];
  const [m1, c1, a1, g1] = KEYS[next];
  const t = m1 === m0 ? 0 : (minute - m0) / (m1 - m0);
  return { color: lerpColor(c0, c1, t), alpha: lerp(a0, a1, t), screensGlow: lerp(g0, g1, t) };
}

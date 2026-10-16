import { describe, expect, it } from 'vitest';
import { layoutBubbles, MAX_LIFTS, stackOrder, type BubbleBox } from '../webview/ui/bubbleLayout';

const box = (id: string, x: number, bottom: number): BubbleBox => ({ id, x, bottom, width: 100, height: 16 });

describe('layoutBubbles', () => {
  it('leaves separated bubbles at their default spot', () => {
    const out = layoutBubbles([box('a', 0, 100), box('b', 300, 100)]);
    expect(out.get('a')).toBe(100);
    expect(out.get('b')).toBe(100);
  });

  it('stacks colliding bubbles without overlap, keeping the lowest anchor in place', () => {
    const boxes = [box('a', 50, 100), box('b', 60, 100), box('c', 55, 102), box('d', 40, 99)];
    const out = layoutBubbles(boxes);
    expect(out.get('c')).toBe(102);
    const spans = boxes.map((b) => [(out.get(b.id) ?? 0) - b.height, out.get(b.id) ?? 0]).sort((p, q) => q[1] - p[1]);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i][1]).toBeLessThanOrEqual(spans[i - 1][0]);
    }
  });

  it('never lifts a bubble above the top of the panel, accepting an overlap instead', () => {
    // Seated characters in the top chair row of a short panel: the default spots sit near the top.
    const boxes = ['a', 'b', 'c', 'd', 'e'].map((id) => box(id, 50, 40));
    const out = layoutBubbles(boxes);
    for (const b of boxes) {
      expect((out.get(b.id) ?? 0) - b.height).toBeGreaterThanOrEqual(0);
    }
    expect(out.get('a')).toBe(40);
    expect(out.get('b')).toBe(22);
  });

  it('stops after MAX_LIFTS lifts, leaving the rest of a tall stack overlapping', () => {
    // In a stack at one x, the n-th bubble needs n lifts: the one past the cap stays where it got to.
    const boxes = Array.from({ length: MAX_LIFTS + 2 }, (_, i) => box(`b${String(i)}`, 50, 1000));
    const out = layoutBubbles(boxes);
    expect(out.get(`b${String(MAX_LIFTS)}`)).toBe(1000 - MAX_LIFTS * 18);
    expect(out.get(`b${String(MAX_LIFTS + 1)}`)).toBe(out.get(`b${String(MAX_LIFTS)}`));
  });

  it('stacks bubbles by left edge, so each one under another keeps a visible strip', () => {
    // Five seated neighbours with no room left to lift: one row, 17.5 px apart, varied widths.
    // Lefts: b0 129, b1 159.5, b2 139.5, b3 216.5, b4 204 — painted in that order, last on top.
    const widths = [130, 104, 179, 60, 120];
    const boxes = widths.map((width, i) => ({ id: `b${String(i)}`, x: 194 + i * 17.5, bottom: 40, width, height: 19 }));
    expect(stackOrder(boxes)).toEqual(['b0', 'b2', 'b1', 'b4', 'b3']);
  });
});

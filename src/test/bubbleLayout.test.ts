import { describe, expect, it } from 'vitest';
import { layoutBubbles, type BubbleBox } from '../webview/ui/bubbleLayout';

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
});

// Greedy, arithmetic-only bubble layout: sizes are measured by the caller when a bubble's
// text changes, so a frame never reads layout.

export interface BubbleBox {
  id: string;
  /** Horizontal centre and bottom edge of the bubble at its default spot. */
  x: number;
  bottom: number;
  width: number;
  height: number;
}

const MARGIN_PX = 2;
const MAX_LIFTS = 16;

function overlaps(a: { x: number; bottom: number; width: number; height: number }, b: typeof a): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + MARGIN_PX &&
    a.bottom > b.bottom - b.height - MARGIN_PX &&
    a.bottom - a.height < b.bottom + MARGIN_PX
  );
}

/**
 * Bottom-most anchors are placed first at their default spot; a bubble that would overlap an
 * already placed one is lifted just above the highest one it hits, until free. x never moves,
 * so a lifted bubble stays above its own character. Returns bottom edge by id.
 */
export function layoutBubbles(boxes: readonly BubbleBox[]): Map<string, number> {
  const placed: BubbleBox[] = [];
  for (const box of [...boxes].sort((a, b) => b.bottom - a.bottom)) {
    let current = box;
    for (let i = 0; i < MAX_LIFTS; i++) {
      const hits = placed.filter((other) => overlaps(current, other));
      if (hits.length === 0) {
        break;
      }
      const top = Math.min(...hits.map((h) => h.bottom - h.height));
      current = { ...current, bottom: top - MARGIN_PX };
    }
    placed.push(current);
  }
  return new Map(placed.map((p) => [p.id, p.bottom]));
}

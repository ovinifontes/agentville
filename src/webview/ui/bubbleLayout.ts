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
export const MAX_LIFTS = 16;

function overlaps(a: { x: number; bottom: number; width: number; height: number }, b: typeof a): boolean {
  return (
    Math.abs(a.x - b.x) < (a.width + b.width) / 2 + MARGIN_PX &&
    a.bottom > b.bottom - b.height - MARGIN_PX &&
    a.bottom - a.height < b.bottom + MARGIN_PX
  );
}

/**
 * Bottom-most anchors are placed first at their default spot; a bubble that would overlap an
 * already placed one is lifted just above the highest one it hits, until free — or until the
 * next lift would cross the top of the overlay root (y 0), where it stays and overlaps. x never
 * moves, so a lifted bubble stays above its own character. Returns bottom edge by id.
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
      const next = Math.min(...hits.map((h) => h.bottom - h.height)) - MARGIN_PX;
      // Never lift past the top of the overlay root: a clipped bubble cannot be clicked, and it
      // is the only way to open that agent's feed. An overlapping but visible one is better.
      if (next - current.height < 0) {
        break;
      }
      current = { ...current, bottom: next };
    }
    placed.push(current);
  }
  return new Map(placed.map((p) => [p.id, p.bottom]));
}

/**
 * Paint order for bubbles that still overlap (no room left to lift them): by left edge, the
 * rightmost-starting last, so on top. Every bubble painted above another then starts further
 * right, which leaves each one a visible, clickable strip up to the next one's left edge. On an
 * exact tie the wider goes under, so the narrower is never covered entirely; then by id, so the
 * order does not depend on the cast's.
 */
export function stackOrder(boxes: readonly BubbleBox[]): string[] {
  const left = (box: BubbleBox): number => box.x - box.width / 2;
  return [...boxes]
    .sort((a, b) => left(a) - left(b) || b.width - a.width || a.id.localeCompare(b.id))
    .map((box) => box.id);
}

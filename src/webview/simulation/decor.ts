// Wall decoration slots. Pure data: one slot per decor id (frame index in decor.png, see
// resources/ASSETS.md), each on a '#' wall tile, so decoration never changes walkability.
// Tiles are chosen to be visible from the floor: the top wall above the desk rooms and the
// meeting room, interior partition walls, and the wall between the office halves. None sits
// on the door row or near the Entrance sign. The clock hangs on a partition whose tile below
// is also wall, so its pendulum (bottom pixel row) never overlaps floor.

export interface DecorSlot {
  /** Index into decor.png: 0 clock, 1 landscape, 2 portrait, 3 poster, 4 whiteboard, 5 window, 6 trophy shelf, 7 certificate. */
  id: number;
  tx: number;
  ty: number;
}

export const DECOR_SLOTS: readonly DecorSlot[] = [
  { id: 0, tx: 11, ty: 1 },
  { id: 1, tx: 5, ty: 0 },
  { id: 2, tx: 16, ty: 0 },
  { id: 3, tx: 28, ty: 0 },
  { id: 4, tx: 34, ty: 0 },
  { id: 5, tx: 30, ty: 11 },
  { id: 6, tx: 22, ty: 3 },
  { id: 7, tx: 11, ty: 6 },
];

/** The slots to draw for the unlocked decor ids; unknown ids are ignored. */
export function visibleDecor(unlocked: readonly number[]): readonly DecorSlot[] {
  const set = new Set(unlocked);
  return DECOR_SLOTS.filter((slot) => set.has(slot.id));
}

// Situated behaviour (sub-project 2): characters go where their work is. Pure — which kind of
// place an activity needs, the spots of each kind (derived once from OFFICE_MAP, never
// hand-listed), and which free spot a character claims.

import type { AgentView } from '../../officeTypes';
import type { Point } from './pathfinding';
import { stableHash, type Character } from './population';
import { MAP_TILES_X, OFFICE_MAP, TILE_SIZE, isWalkable, tileAt } from './world';

export type PlaceKind = 'desk' | 'shelf' | 'meeting' | 'lounge';

export interface Spot {
  /** Tile centre in world pixels: where the character's feet stand. */
  x: number;
  y: number;
  kind: PlaceKind;
  /** One-tile step toward the furniture used here (down when sitting on the sofa): the way the character faces. */
  face: Point;
}

const UP: Point = { x: 0, y: -1 };
const DOWN: Point = { x: 0, y: 1 };

// Leading verb of the action string (src/activityExtractor.ts). Editing, Running, Planning,
// Thinking, Working — and anything unknown — happen at a desk. A Map, not an object literal,
// so an action such as "constructor" cannot hit Object.prototype.
const PLACE_BY_VERB = new Map<string, PlaceKind>([
  ['Reading', 'shelf'],
  ['Searching', 'shelf'],
  ['Researching', 'shelf'],
  ['Delegating', 'meeting'],
]);

/**
 * The kind of place an agent's activity calls for. Keyed on status, not on a missing action:
 * a working agent may have none yet, and Antigravity agents never do — both work at a desk.
 */
export function placeFor(agent: Pick<AgentView, 'status' | 'action'>): PlaceKind {
  if (agent.status === 'stopped') {
    return 'lounge';
  }
  return PLACE_BY_VERB.get((agent.action ?? '').split(' ', 1)[0]) ?? 'desk';
}

// Furniture is used from the tile below it: in this top-down view that is its front.
const USED_FROM_BELOW = new Map<string, PlaceKind>([
  ['D', 'desk'],
  ['R', 'shelf'],
  ['K', 'lounge'],
]);

function standable(tx: number, ty: number): boolean {
  return isWalkable(tx * TILE_SIZE, ty * TILE_SIZE);
}

/** The first solid tile met going straight up (dy -1) or down (dy 1) from (tx, ty). */
function solidAlong(tx: number, ty: number, dy: number): string {
  let y = ty + dy;
  while (standable(tx, y)) {
    y += dy;
  }
  return tileAt(tx, y);
}

function spotAt(tx: number, ty: number): Pick<Spot, 'kind' | 'face'> | undefined {
  if (tileAt(tx, ty) === 'S') {
    return { kind: 'lounge', face: DOWN }; // sitting on the sofa, facing the room
  }
  if (!standable(tx, ty)) {
    return undefined;
  }
  // Inside the meeting table: table above and below, chairs included. Face the nearer edge.
  if (solidAlong(tx, ty, -1) === 'T' && solidAlong(tx, ty, 1) === 'T') {
    return { kind: 'meeting', face: tileAt(tx, ty - 1) === 'T' ? UP : DOWN };
  }
  const kind = USED_FROM_BELOW.get(tileAt(tx, ty - 1));
  return kind && { kind, face: UP };
}

/** Every spot, row by row. Computed once — the map never changes. */
export const SPOTS: readonly Spot[] = OFFICE_MAP.flatMap((row, ty) =>
  row.split('').flatMap((_, tx) => {
    const spot = spotAt(tx, ty);
    return spot ? [{ x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2, ...spot }] : [];
  }),
);

function tileIndex(point: Point): number {
  return Math.floor(point.y / TILE_SIZE) * MAP_TILES_X + Math.floor(point.x / TILE_SIZE);
}

const SPOT_TILES = new Set(SPOTS.map(tileIndex));

/** On a spot's tile? Wanderers keep off them, so they never stop on a seat or in a claimed place. */
export function isSpot(point: Point): boolean {
  return SPOT_TILES.has(tileIndex(point));
}

/**
 * A free spot of `kind` for `character`, or undefined when every one is held by someone else
 * in `cast`. The search starts at a stable hash of the agent id, so an agent tends to return
 * to the same desk.
 */
export function claimSpot(character: Character, kind: PlaceKind, cast: readonly Character[]): Spot | undefined {
  const taken = new Set(cast.filter((other) => other.id !== character.id).map((other) => other.spot));
  const spots = SPOTS.filter((spot) => spot.kind === kind);
  const start = stableHash(character.id) % spots.length;
  return [...spots.slice(start), ...spots.slice(0, start)].find((spot) => !taken.has(spot));
}

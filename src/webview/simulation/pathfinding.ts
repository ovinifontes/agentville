// Grid routing over OFFICE_MAP walkability. Pure: breadth-first search, 4-neighbour moves
// (the sprites only face four ways), uniform cost. Callers search once per new target.
// A seat (chair, sofa) is only ever a route's start or goal, never a way through: otherwise the
// shortest routes run along the chair rows, over seated characters.

import { MAP_TILES_X, TILE_SIZE, isSeat, isWalkable } from './world';

export interface Point {
  x: number;
  y: number;
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function centre(index: number): Point {
  return {
    x: (index % MAP_TILES_X) * TILE_SIZE + TILE_SIZE / 2,
    y: Math.floor(index / MAP_TILES_X) * TILE_SIZE + TILE_SIZE / 2,
  };
}

/**
 * Breadth-first search from the tile under (x, y): parent per reachable tile index, in visit order.
 * Seats are recorded (reachable as a goal) but not expanded; the start is expanded even on a seat.
 */
function search(x: number, y: number): Map<number, number> {
  const parents = new Map<number, number>();
  if (!isWalkable(x, y)) {
    return parents;
  }
  const start = Math.floor(y / TILE_SIZE) * MAP_TILES_X + Math.floor(x / TILE_SIZE);
  parents.set(start, start);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const tx = current % MAP_TILES_X;
    const ty = Math.floor(current / MAP_TILES_X);
    for (const [dx, dy] of NEIGHBOURS) {
      const x = (tx + dx) * TILE_SIZE;
      const y = (ty + dy) * TILE_SIZE;
      const next = (ty + dy) * MAP_TILES_X + tx + dx;
      // isWalkable is false off the map, so an out-of-range neighbour's index (which would alias
      // a tile in the next row) is never recorded.
      if (!parents.has(next) && isWalkable(x, y)) {
        parents.set(next, current);
        if (!isSeat(x, y)) {
          queue.push(next);
        }
      }
    }
  }
  return parents;
}

/** Tile centres reachable from (x, y) (seats as goals), nearest first. Empty when (x, y) is not walkable. */
export function reachableTiles(x: number, y: number): Point[] {
  return [...search(x, y).keys()].map(centre);
}

/**
 * Waypoints (tile centres) from `from` to the tile under `to`, ending on that centre.
 * The start tile's centre leads unless already there, so no corner is cut. Empty when either
 * end is unwalkable or unreachable — callers then keep the straight-line step.
 */
export function findPath(from: Point, to: Point): Point[] {
  const parents = search(from.x, from.y);
  let index = Math.floor(to.y / TILE_SIZE) * MAP_TILES_X + Math.floor(to.x / TILE_SIZE);
  if (!isWalkable(to.x, to.y) || !parents.has(index)) {
    return [];
  }
  const path: Point[] = [];
  for (let parent = parents.get(index); parent !== undefined; parent = parents.get(index)) {
    path.push(centre(index));
    if (parent === index) {
      break;
    }
    index = parent;
  }
  const first = path.pop();
  if (first && (first.x !== from.x || first.y !== from.y)) {
    path.push(first);
  }
  return path.reverse();
}

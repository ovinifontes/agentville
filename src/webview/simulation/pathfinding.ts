// Grid routing over OFFICE_MAP walkability. Pure: breadth-first search, 4-neighbour moves
// (the sprites only face four ways), uniform cost. Callers search once per new target.

import { MAP_TILES_X, MAP_TILES_Y, TILE_SIZE, isWalkable } from './world';

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

/** Breadth-first search from the tile under (x, y): parent per reachable tile index, in visit order. */
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
      const nx = tx + dx;
      const ny = ty + dy;
      const next = ny * MAP_TILES_X + nx;
      const inside = nx >= 0 && ny >= 0 && nx < MAP_TILES_X && ny < MAP_TILES_Y;
      if (inside && !parents.has(next) && isWalkable(nx * TILE_SIZE, ny * TILE_SIZE)) {
        parents.set(next, current);
        queue.push(next);
      }
    }
  }
  return parents;
}

/** Tile centres reachable from (x, y), nearest first. Empty when (x, y) is not walkable. */
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

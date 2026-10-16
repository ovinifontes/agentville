// Position stepping and target selection. Characters wander between reachable tiles,
// following a grid path around furniture; with no path they step straight at the target.

import type { Character } from './population';
import { findPath, reachableTiles } from './pathfinding';

const SPEED_PX_PER_MS = 0.02;

export function step(character: Character, deltaMs: number): Character {
  const waypoint = character.path.at(0);
  const goalX = waypoint?.x ?? character.targetX;
  const goalY = waypoint?.y ?? character.targetY;
  const dx = goalX - character.x;
  const dy = goalY - character.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    return character;
  }
  const travel = Math.min(distance, SPEED_PX_PER_MS * deltaMs);
  const arrived = waypoint !== undefined && travel === distance;
  return {
    ...character,
    // Land exactly on a reached waypoint so axis-aligned legs stay on the tile centres.
    x: arrived ? goalX : character.x + (dx / distance) * travel,
    y: arrived ? goalY : character.y + (dy / distance) * travel,
    path: arrived ? character.path.slice(1) : character.path,
  };
}

/** Choose a new wander destination among the tiles reachable on foot. `random` is injected so tests stay deterministic. */
export function pickTarget(character: Character, random: () => number): Character {
  // Draw from the reachable set rather than guessing coordinates: the map is furnished, so
  // most of the grid is solid and rejection sampling would stall against desks.
  const tiles = reachableTiles(character.x, character.y);
  if (tiles.length === 0) {
    return { ...character, state: 'idle', path: [] };
  }
  const tile = tiles[Math.min(tiles.length - 1, Math.floor(random() * tiles.length))];
  const path = findPath(character, tile);
  return { ...character, targetX: tile.x, targetY: tile.y, path, state: 'walking' };
}

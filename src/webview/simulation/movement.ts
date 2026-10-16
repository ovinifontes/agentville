// Position stepping and target selection. Characters wander between reachable tiles,
// following a grid path around furniture; with no path they step straight at the target.
// Sub-project 2 replaces `pickTarget` with furniture-aware selection; a replacement must also
// set `path` (via `findPath`), or characters fall back to the straight line.

import type { Character } from './population';
import { findPath, reachableTiles } from './pathfinding';

const SPEED_PX_PER_MS = 0.02;

/** Next waypoint, else the target. */
function goalOf(character: Character): { x: number; y: number } {
  return character.path.at(0) ?? { x: character.targetX, y: character.targetY };
}

export function step(character: Character, deltaMs: number): Character {
  const hasWaypoint = character.path.length > 0;
  const { x: goalX, y: goalY } = goalOf(character);
  const dx = goalX - character.x;
  const dy = goalY - character.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    // Already on the waypoint: drop it, or the character would sit here forever.
    return hasWaypoint ? { ...character, path: character.path.slice(1) } : character;
  }
  const travel = Math.min(distance, SPEED_PX_PER_MS * deltaMs);
  const x = character.x + (dx / distance) * travel;
  const y = character.y + (dy / distance) * travel;
  // A partial step can round onto the waypoint exactly; that counts as arriving.
  const arrived = hasWaypoint && (travel === distance || (x === goalX && y === goalY));
  return {
    ...character,
    // Land exactly on a reached waypoint so axis-aligned legs stay on the tile centres.
    x: arrived ? goalX : x,
    y: arrived ? goalY : y,
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

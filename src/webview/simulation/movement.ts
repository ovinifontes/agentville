// Position stepping and target selection. Characters walk a grid path around furniture to
// a spot that matches their activity (situated.ts); when every such spot is taken they wander
// between reachable tiles. With no path they step straight at the target.

import type { Character } from './population';
import { findPath, reachableTiles } from './pathfinding';
import { claimSpot, placeFor } from './situated';

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

/** Choose a wander destination among the tiles reachable on foot. */
function wander(character: Character, random: () => number): Character {
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

/**
 * Send the character to a free spot for its current activity, else wander. `cast` holds the
 * other characters' claims; `random` (wandering only) is injected so tests stay deterministic.
 */
export function pickTarget(character: Character, random: () => number, cast: readonly Character[] = []): Character {
  const place = placeFor(character.agent.action);
  const spot = claimSpot(character, place, cast);
  if (!spot) {
    return { ...wander(character, random), place, spot: undefined };
  }
  const path = findPath(character, spot);
  return { ...character, targetX: spot.x, targetY: spot.y, path, state: 'walking', place, spot };
}

/**
 * Called every frame: re-targets only when the activity now needs a different kind of place
 * (or none was chosen yet); otherwise returns the same character, with no search. Leaving wins.
 */
export function followActivity(character: Character, random: () => number, cast: readonly Character[]): Character {
  if (character.state === 'leaving' || placeFor(character.agent.action) === character.place) {
    return character;
  }
  return pickTarget(character, random, cast);
}

// Position stepping and target selection. Characters walk a grid path around furniture to
// a spot that matches their activity (situated.ts); when every such spot is taken they wander
// between reachable tiles. With no path they step straight at the target.

import type { Character } from './population';
import { findPath, reachableTiles } from './pathfinding';
import { claimSpot, isSpot, placeFor } from './situated';

const SPEED_PX_PER_MS = 0.02;
/** Minimum stay at a claimed spot before a change of activity sends the character elsewhere (spec S5). */
export const DWELL_MS = 5000;
/** A wanderer's pause on arrival before it tries for a spot again, or wanders on. */
export const IDLE_PAUSE_MS = 1200;

/** What a frame's decision needs: the frame time (ms), the cast's claims, and the dice. */
export interface Frame {
  now: number;
  cast: readonly Character[];
  random: () => number;
}

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

/** Choose a wander destination among the tiles reachable on foot, off every spot. */
function wander(character: Character, random: () => number): Character {
  // Draw from the reachable set rather than guessing coordinates: the map is furnished, so
  // most of the grid is solid and rejection sampling would stall against desks. Spots are
  // left out, so a wanderer never stops on a seat or in another character's place.
  const tiles = reachableTiles(character.x, character.y).filter((tile) => !isSpot(tile));
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
  const place = placeFor(character.agent);
  const spot = claimSpot(character, place, cast);
  if (!spot) {
    return { ...wander(character, random), place, spot: undefined, arrivedAt: undefined };
  }
  const path = findPath(character, spot);
  const target = { targetX: spot.x, targetY: spot.y, path, place, spot, arrivedAt: undefined };
  return { ...character, ...target, state: 'walking' };
}

function hasArrived(character: Character): boolean {
  return character.x === character.targetX && character.y === character.targetY;
}

/** Waited long enough where it stands: a wanderer's pause, or the dwell at a spot before a change of place. */
function doneWaiting(character: Character, placeChanged: boolean, now: number): boolean {
  const waited = now - (character.arrivedAt ?? now);
  return character.spot ? placeChanged && waited >= DWELL_MS : waited >= IDLE_PAUSE_MS;
}

/**
 * The per-frame decision, after `step`. It searches only when it re-targets:
 * - walking, or without a spot, as soon as the activity needs a different kind of place;
 * - at a claimed spot, once it has been there DWELL_MS, and only for a different kind of place;
 * - a wanderer, after pausing IDLE_PAUSE_MS on arrival (it tries for a spot again first).
 * Otherwise it returns the same character. Arrival is recorded once; leaving is left alone.
 */
export function followActivity(character: Character, frame: Frame): Character {
  if (character.state === 'leaving') {
    return character;
  }
  const placeChanged = placeFor(character.agent) !== character.place;
  const arrived = hasArrived(character);
  if (placeChanged && !(arrived && character.spot)) {
    return pickTarget(character, frame.random, frame.cast);
  }
  if (!arrived) {
    return character;
  }
  if (character.arrivedAt === undefined) {
    return { ...character, state: 'idle', arrivedAt: frame.now };
  }
  return doneWaiting(character, placeChanged, frame.now) ? pickTarget(character, frame.random, frame.cast) : character;
}

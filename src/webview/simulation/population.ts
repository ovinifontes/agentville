// Reconciles a snapshot against the current cast. Pure: takes the old cast plus the new
// agent list, returns a brand-new cast. Never mutates its input — the renderer holds a
// reference to the previous array while this runs.

import type { AgentView } from '../../officeTypes';
import { findPath, type Point } from './pathfinding';
import type { PlaceKind, Spot } from './situated';
import { DOOR } from './world';

export const SPRITE_VARIANTS = 4;

export type CharacterState = 'entering' | 'walking' | 'idle' | 'leaving';

export interface Character {
  id: string;
  sprite: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  state: CharacterState;
  /** Remaining waypoints (tile centres) toward the target; empty when walking straight. */
  path: Point[];
  agent: AgentView;
  /** Spot claimed for the current activity; none while wandering (its kind was full) or leaving. */
  spot?: Spot;
  /** Kind of place last targeted for; a different kind for the current activity means re-target. */
  place?: PlaceKind;
  /** Frame time (ms) it reached its current target; undefined while walking. */
  arrivedAt?: number;
  /** A different kind of place the activity calls for, and the frame time (ms) it first did; cleared when they agree again. */
  pending?: { kind: PlaceKind; since: number };
}

/** Non-negative string hash, stable across runs (Java's String.hashCode, made positive). */
export function stableHash(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Stable per-name sprite choice, so the same agent is always the same person. */
export function spriteVariantFor(name: string): number {
  return stableHash(name) % SPRITE_VARIANTS;
}

function spawn(agent: AgentView): Character {
  return {
    id: agent.id,
    sprite: spriteVariantFor(agent.name),
    x: DOOR.x,
    y: DOOR.y,
    targetX: DOOR.x,
    targetY: DOOR.y,
    state: 'entering',
    path: [],
    agent,
  };
}

const AT_DOOR_EPSILON = 1;

function hasReachedDoor(character: Character): boolean {
  return Math.abs(character.x - DOOR.x) <= AT_DOOR_EPSILON && Math.abs(character.y - DOOR.y) <= AT_DOOR_EPSILON;
}

export function reconcile(cast: readonly Character[], agents: readonly AgentView[]): Character[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const seen = new Set<string>();

  const kept: Character[] = [];
  for (const character of cast) {
    const agent = byId.get(character.id);
    if (agent) {
      seen.add(character.id);
      // Back before it reached the door: stop where it stands — still 'leaving', it would walk
      // out and wait at the door forever. Its place was forgotten on leaving, so later in this same
      // update() followActivity claims a spot for its activity (or wanders if that kind is full).
      kept.push(
        character.state === 'leaving'
          ? { ...character, agent, state: 'idle', targetX: character.x, targetY: character.y, path: [] }
          : { ...character, agent },
      );
      continue;
    }
    if (character.state === 'leaving' && hasReachedDoor(character)) {
      continue; // walked out — drop it
    }
    // Route once, when it starts leaving; reconcile runs every frame. Its spot is freed for
    // others, and forgetting the place makes it claim a new spot if its agent comes back.
    const path = character.state === 'leaving' ? character.path : findPath(character, DOOR);
    kept.push({
      ...character,
      state: 'leaving',
      targetX: DOOR.x,
      targetY: DOOR.y,
      path,
      spot: undefined,
      place: undefined,
      arrivedAt: undefined,
    });
  }

  const spawned = agents.filter((agent) => !seen.has(agent.id)).map(spawn);
  return [...kept, ...spawned];
}

// Reconciles a snapshot against the current cast. Pure: takes the old cast plus the new
// agent list, returns a brand-new cast. Never mutates its input — the renderer holds a
// reference to the previous array while this runs.

import type { AgentView } from '../../officeTypes';
import { findPath, type Point } from './pathfinding';
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
}

/** Stable per-name sprite choice, so the same agent is always the same person. */
export function spriteVariantFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % SPRITE_VARIANTS;
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
      // Back before it reached the door: stop where it stands, so the renderer pauses it and
      // it wanders on — still 'leaving', it would walk out and wait at the door forever.
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
    // Route once, when it starts leaving; reconcile runs every frame.
    const path = character.state === 'leaving' ? character.path : findPath(character, DOOR);
    kept.push({ ...character, state: 'leaving', targetX: DOOR.x, targetY: DOOR.y, path });
  }

  const spawned = agents.filter((agent) => !seen.has(agent.id)).map(spawn);
  return [...kept, ...spawned];
}

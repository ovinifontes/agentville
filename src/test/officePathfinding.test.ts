import { describe, it, expect } from 'vitest';
import { DOOR, TILE_SIZE, isWalkable, tileAt, walkableTiles } from '../webview/simulation/world';
import { findPath, reachableTiles } from '../webview/simulation/pathfinding';
import { reconcile, type Character } from '../webview/simulation/population';
import { step, pickTarget } from '../webview/simulation/movement';
import type { AgentView } from '../officeTypes';

const agent: AgentView = {
  id: 'a1',
  kind: 'session',
  name: 'proj',
  projectName: 'proj',
  brand: 'claude-code',
  status: 'working',
  lastActivityAt: 1,
};

function atDoor(): Character {
  return reconcile([], [agent])[0];
}

/** On a chair or sofa tile (a seat). */
function onSeat(point: { x: number; y: number }): boolean {
  return 'CS'.includes(tileAt(Math.floor(point.x / TILE_SIZE), Math.floor(point.y / TILE_SIZE)));
}

function key(point: { x: number; y: number }): string {
  return `${String(point.x)},${String(point.y)}`;
}

function expectValidPath(from: { x: number; y: number }, path: { x: number; y: number }[]): void {
  let previous = from;
  for (const point of path) {
    expect(isWalkable(point.x, point.y)).toBe(true);
    const tiles = Math.abs(point.x - previous.x) / TILE_SIZE + Math.abs(point.y - previous.y) / TILE_SIZE;
    expect(tiles).toBe(1);
    previous = point;
  }
}

describe('pathfinding', () => {
  it('reaches every walkable floor tile from the door, and every seat as a goal', () => {
    const reachable = new Set(reachableTiles(DOOR.x, DOOR.y).map(key));
    for (const tile of walkableTiles()) {
      expect(reachable.has(key(tile))).toBe(true);
      if (key(tile) === key(DOOR)) {
        continue; // already there: an empty path
      }
      const path = findPath(DOOR, tile);
      expect(path.at(-1)).toEqual(tile);
      expectValidPath(DOOR, path);
    }
  });

  it('walks between floor tiles on the floor, never across a seat', () => {
    // Along the chair row (1,3) -> (6,3) is 5 steps over four chairs; the floor route is 7.
    const from = { x: 1 * TILE_SIZE + 8, y: 3 * TILE_SIZE + 8 };
    const to = { x: 6 * TILE_SIZE + 8, y: 3 * TILE_SIZE + 8 };
    const along = findPath(from, to);
    expect(along).toHaveLength(7);
    expect(along.some(onSeat)).toBe(false);
    for (const tile of walkableTiles().filter((t) => !onSeat(t))) {
      expect(findPath(DOOR, tile).some(onSeat)).toBe(false);
      expect(findPath(from, tile).some(onSeat)).toBe(false);
    }
  });

  it('leaves a seat it starts on and enters a seat it ends on, but crosses none between', () => {
    const chair = { x: 2 * TILE_SIZE + 8, y: 3 * TILE_SIZE + 8 };
    const sofa = { x: 3 * TILE_SIZE + 8, y: 15 * TILE_SIZE + 8 };
    const path = findPath(chair, sofa);
    expect(path.at(-1)).toEqual(sofa);
    expectValidPath(chair, path);
    expect(path.slice(0, -1).some(onSeat)).toBe(false);
  });

  it('routes along 4-adjacent walkable tiles and ends on the target centre', () => {
    const target = { x: 2 * TILE_SIZE + 8, y: 4 * TILE_SIZE + 8 };
    const path = findPath(DOOR, target);
    expect(path.at(-1)).toEqual(target);
    expectValidPath(DOOR, path);
  });

  it('leads with the start tile centre when not standing on it', () => {
    const path = findPath({ x: DOOR.x + 3, y: DOOR.y }, { x: DOOR.x + TILE_SIZE, y: DOOR.y });
    expect(path[0]).toEqual({ x: DOOR.x, y: DOOR.y });
  });

  it('gives no path from or to a solid tile', () => {
    expect(findPath({ x: TILE_SIZE / 2, y: TILE_SIZE / 2 }, DOOR)).toEqual([]);
    expect(findPath(DOOR, { x: TILE_SIZE / 2, y: TILE_SIZE / 2 })).toEqual([]);
  });

  it('pickTarget yields a reachable target with a valid path, deterministically', () => {
    const first = pickTarget(atDoor(), () => 0.37);
    expect(pickTarget(atDoor(), () => 0.37)).toEqual(first);
    expect(first.path.at(-1)).toEqual({ x: first.targetX, y: first.targetY });
    expectValidPath(DOOR, first.path);
  });

  it('never samples a solid tile while stepping along a path', () => {
    for (const roll of [0.1, 0.5, 0.9]) {
      let walker = pickTarget(atDoor(), () => roll);
      for (let i = 0; i < 20000 && (walker.x !== walker.targetX || walker.y !== walker.targetY); i++) {
        walker = step(walker, 5);
        expect(isWalkable(walker.x, walker.y)).toBe(true);
      }
      expect([walker.x, walker.y]).toEqual([walker.targetX, walker.targetY]);
      expect(walker.path).toEqual([]);
    }
  });

  it('routes a leaving character to the door and clears the path if it returns', () => {
    const away = { ...pickTarget(atDoor(), () => 0.9), x: 5 * TILE_SIZE + 8, y: 4 * TILE_SIZE + 8 };
    const leaving = reconcile([away], [])[0];
    expect(leaving.state).toBe('leaving');
    expect(leaving.path.at(-1)).toEqual({ x: DOOR.x, y: DOOR.y });
    expectValidPath({ x: away.x, y: away.y }, leaving.path);
    expect(reconcile([leaving], [])[0].path).toBe(leaving.path);
    expect(reconcile([leaving], [agent])[0].path).toEqual([]);
  });

  it('reaches the door after turning back mid-tile', () => {
    const start = { x: DOOR.x + 2 * TILE_SIZE, y: DOOR.y };
    let walker: Character = {
      ...atDoor(),
      ...start,
      targetX: start.x + TILE_SIZE,
      targetY: start.y,
      path: [{ x: start.x + TILE_SIZE, y: start.y }],
      state: 'walking',
    };
    for (let i = 0; i < 3; i++) {
      walker = step(walker, 16.7);
    }
    let cast = reconcile([walker], []);
    for (let i = 0; i < 1000 && cast.length > 0; i++) {
      cast = reconcile(cast, []).map((c) => step(c, 16.7));
    }
    expect(cast).toEqual([]);
  });
});

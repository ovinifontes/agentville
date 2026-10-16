import { describe, it, expect } from 'vitest';
import { DOOR, OFFICE_MAP, TILE_SIZE, isWalkable, tileAt } from '../webview/simulation/world';
import { reachableTiles, type Point } from '../webview/simulation/pathfinding';
import { reconcile, type Character } from '../webview/simulation/population';
import { followActivity, pickTarget, step } from '../webview/simulation/movement';
import { SPOTS, claimSpot, placeFor, type PlaceKind } from '../webview/simulation/situated';
import type { AgentView } from '../officeTypes';

function agent(id: string, action?: string): AgentView {
  return {
    id,
    kind: 'session',
    name: id,
    projectName: 'proj',
    brand: 'claude-code',
    status: action === undefined ? 'stopped' : 'working',
    action,
    lastActivityAt: 1,
  };
}

/** A fresh character at the door. */
function newcomer(id: string, action?: string): Character {
  return reconcile([], [agent(id, action)])[0];
}

function doing(character: Character, action: string | undefined): Character {
  return { ...character, agent: { ...character.agent, action } };
}

function noRandom(): number {
  throw new Error('no random draw expected');
}

function expectValidPath(from: Point, path: Point[]): void {
  let previous = from;
  for (const point of path) {
    expect(isWalkable(point.x, point.y)).toBe(true);
    const tiles = Math.abs(point.x - previous.x) / TILE_SIZE + Math.abs(point.y - previous.y) / TILE_SIZE;
    expect(tiles).toBe(1);
    previous = point;
  }
}

/** Steps to the target, asserting it never stands on a solid tile on the way. */
function walk(character: Character): Character {
  let walker = character;
  for (let i = 0; i < 40000 && (walker.x !== walker.targetX || walker.y !== walker.targetY); i++) {
    walker = step(walker, 5);
    expect(isWalkable(walker.x, walker.y)).toBe(true);
  }
  expect([walker.x, walker.y]).toEqual([walker.targetX, walker.targetY]);
  return walker;
}

function spotsOf(kind: PlaceKind): typeof SPOTS {
  return SPOTS.filter((spot) => spot.kind === kind);
}

/** One character per spot of `kind`, each claimed through pickTarget against the cast so far. */
function fill(kind: PlaceKind, action: string | undefined): Character[] {
  const cast: Character[] = [];
  for (let i = 0; i < spotsOf(kind).length; i++) {
    cast.push(pickTarget(newcomer(`${kind}-${String(i)}`, action), noRandom, cast));
  }
  return cast;
}

const FURNITURE: Record<PlaceKind, string> = { desk: 'D', shelf: 'R', meeting: 'T', lounge: 'K' };

describe('placeFor', () => {
  it.each([
    ['Reading x.ts', 'shelf'],
    ['Reading', 'shelf'],
    ['Searching for TODO', 'shelf'],
    ['Searching', 'shelf'],
    ['Researching', 'shelf'],
    ['Editing x.ts', 'desk'],
    ['Editing', 'desk'],
    ['Running npm test', 'desk'],
    ['Running a command', 'desk'],
    ['Planning', 'desk'],
    ['Thinking', 'desk'],
    ['Working', 'desk'],
    ['Delegating to explorer', 'meeting'],
    ['Delegating', 'meeting'],
    ['Juggling chainsaws', 'desk'],
    ['constructor', 'desk'],
  ])('%s → %s', (action, place) => {
    expect(placeFor(action)).toBe(place);
  });

  it('sends an agent with no action (stopped) to the lounge', () => {
    expect(placeFor(undefined)).toBe('lounge');
  });
});

describe('spots', () => {
  const tileOf = (point: Point): [number, number] => [Math.floor(point.x / TILE_SIZE), Math.floor(point.y / TILE_SIZE)];

  it('derives every kind of place from the map', () => {
    const counts = Object.fromEntries(
      (['desk', 'shelf', 'meeting', 'lounge'] as const).map((kind) => [kind, spotsOf(kind).length]),
    );
    expect(counts).toEqual({ desk: 32, shelf: 8, meeting: 16, lounge: 8 });
  });

  it('lists each tile at most once, on its centre', () => {
    expect(new Set(SPOTS.map((spot) => `${String(spot.x)},${String(spot.y)}`)).size).toBe(SPOTS.length);
    for (const spot of SPOTS) {
      expect(spot.x % TILE_SIZE).toBe(TILE_SIZE / 2);
      expect(spot.y % TILE_SIZE).toBe(TILE_SIZE / 2);
    }
  });

  it('can reach every spot from the door', () => {
    const reachable = new Set(reachableTiles(DOOR.x, DOOR.y).map((p) => `${String(p.x)},${String(p.y)}`));
    for (const spot of SPOTS) {
      expect(reachable.has(`${String(spot.x)},${String(spot.y)}`)).toBe(true);
    }
  });

  it('faces each spot toward its furniture, and down on the sofa', () => {
    for (const spot of SPOTS) {
      const [tx, ty] = tileOf(spot);
      if (tileAt(tx, ty) === 'S') {
        expect(spot.kind).toBe('lounge');
        expect(spot.face).toEqual({ x: 0, y: 1 });
        continue;
      }
      expect(Math.abs(spot.face.x) + Math.abs(spot.face.y)).toBe(1);
      expect(tileAt(tx + spot.face.x, ty + spot.face.y)).toBe(FURNITURE[spot.kind]);
    }
  });

  it('seats desk spots on chairs, and makes every chair and sofa tile a spot', () => {
    for (const spot of spotsOf('desk')) {
      expect(tileAt(...tileOf(spot))).toBe('C');
    }
    const seats = SPOTS.filter((spot) => 'CS'.includes(tileAt(...tileOf(spot))));
    const seatTiles = OFFICE_MAP.join('')
      .split('')
      .filter((tile) => 'CS'.includes(tile));
    expect(seats).toHaveLength(seatTiles.length);
  });

  it('makes chairs and the sofa walkable seats while furniture stays solid', () => {
    OFFICE_MAP.forEach((row, ty) => {
      row.split('').forEach((tile, tx) => {
        const walkable = isWalkable(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2);
        if ('CS'.includes(tile)) {
          expect(walkable).toBe(true);
        }
        if ('DTRKP#'.includes(tile)) {
          expect(walkable).toBe(false);
        }
      });
    });
  });
});

describe('claiming', () => {
  it('makes the same agent prefer the same spot', () => {
    const first = claimSpot(newcomer('refactor-auth'), 'desk', []);
    expect(first).toBeDefined();
    expect(claimSpot(newcomer('refactor-auth'), 'desk', [])).toBe(first);
  });

  it('spreads different agents over different spots', () => {
    const preferred = new Set(
      ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].map((id) => claimSpot(newcomer(id), 'desk', [])),
    );
    expect(preferred.size).toBeGreaterThan(1);
  });

  it("does not count a character's own spot as taken", () => {
    const seated = pickTarget(newcomer('alpha', 'Editing x.ts'), noRandom, []);
    expect(claimSpot(seated, 'desk', [seated])).toBe(seated.spot);
  });

  it('never gives two characters the same spot', () => {
    for (const [kind, action] of [
      ['shelf', 'Reading x.ts'],
      ['lounge', undefined],
      ['meeting', 'Delegating to explorer'],
    ] as const) {
      const cast = fill(kind, action);
      expect(cast.length).toBeGreaterThan(0);
      const claimed = cast.map((character) => character.spot);
      expect(claimed.every((spot) => spot?.kind === kind)).toBe(true);
      expect(new Set(claimed).size).toBe(spotsOf(kind).length);
    }
  });

  it('falls back to wandering when every spot of the kind is taken', () => {
    const cast = fill('shelf', 'Reading x.ts');
    const late = newcomer('late', 'Reading y.ts');
    expect(claimSpot(late, 'shelf', cast)).toBeUndefined();
    const wandering = pickTarget(late, () => 0.5, cast);
    expect(wandering.spot).toBeUndefined();
    expect(wandering.place).toBe('shelf');
    expect(wandering.state).toBe('walking');
    expect(isWalkable(wandering.targetX, wandering.targetY)).toBe(true);
    expect(wandering.path.at(-1)).toEqual({ x: wandering.targetX, y: wandering.targetY });
    expectValidPath(DOOR, wandering.path);
  });
});

describe('re-targeting', () => {
  it('sends a newcomer straight to a spot for its activity', () => {
    const editor = followActivity(newcomer('alpha', 'Editing x.ts'), noRandom, []);
    expect(editor.place).toBe('desk');
    expect(editor.spot?.kind).toBe('desk');
    expect({ x: editor.targetX, y: editor.targetY }).toEqual({ x: editor.spot?.x, y: editor.spot?.y });
    expect(editor.state).toBe('walking');
    expectValidPath(DOOR, editor.path);
  });

  it('leaves a character at its spot alone while the kind of place is unchanged', () => {
    const seated = walk(followActivity(newcomer('alpha', 'Editing x.ts'), noRandom, []));
    expect(seated.spot?.kind).toBe('desk');
    const running = doing(seated, 'Running npm test');
    expect(followActivity(running, noRandom, [running])).toBe(running);
  });

  it('does not re-search for a wanderer whose kind is still full', () => {
    const cast = fill('shelf', 'Reading x.ts');
    const wandering = pickTarget(newcomer('late', 'Reading y.ts'), () => 0.5, cast);
    const stillReading = doing(wandering, 'Searching for TODO');
    expect(followActivity(stillReading, noRandom, [...cast, stillReading])).toBe(stillReading);
  });

  it('walks to a new spot, without crossing furniture, when the kind changes', () => {
    const seated = walk(followActivity(newcomer('alpha', 'Editing x.ts'), noRandom, []));
    const reading = doing(seated, 'Reading x.ts');
    const moved = followActivity(reading, noRandom, [reading]);
    expect(moved.place).toBe('shelf');
    expect(moved.spot?.kind).toBe('shelf');
    expect(moved.path.at(-1)).toEqual({ x: moved.spot?.x, y: moved.spot?.y });
    expectValidPath(seated, moved.path);
    walk(moved);
  });

  it('lets leaving override the activity, and re-claims a spot on return', () => {
    const seated = walk(followActivity(newcomer('alpha', 'Editing x.ts'), noRandom, []));
    expect(seated.spot).toBeDefined();
    const leaving = reconcile([seated], [])[0];
    expect(leaving.state).toBe('leaving');
    expect(leaving.spot).toBeUndefined();
    expect(followActivity(leaving, noRandom, [leaving])).toBe(leaving);
    const back = reconcile([leaving], [seated.agent])[0];
    const reseated = followActivity(back, noRandom, [back]);
    expect(reseated.spot).toBe(seated.spot);
    expectValidPath(back, reseated.path);
  });
});

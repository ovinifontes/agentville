import { describe, it, expect } from 'vitest';
import { DOOR, OFFICE_MAP, TILE_SIZE, isWalkable, tileAt } from '../webview/simulation/world';
import { findPath, type Point } from '../webview/simulation/pathfinding';
import { reconcile, type Character } from '../webview/simulation/population';
import {
  DWELL_MS,
  IDLE_PAUSE_MS,
  PLACE_SETTLE_MS,
  followActivity,
  pickTarget,
  step,
  type Frame,
} from '../webview/simulation/movement';
import { SPOTS, claimSpot, placeFor, type PlaceKind } from '../webview/simulation/situated';
import type { AgentView } from '../officeTypes';

function agent(id: string, action?: string, status: AgentView['status'] = action ? 'working' : 'stopped'): AgentView {
  return {
    id,
    kind: 'session',
    name: id,
    projectName: 'proj',
    brand: 'claude-code',
    status,
    action,
    lastActivityAt: 1,
  };
}

/** A fresh character at the door. */
function newcomer(id: string, action?: string, status?: AgentView['status']): Character {
  return reconcile([], [agent(id, action, status)])[0];
}

function doing(character: Character, action: string | undefined): Character {
  return { ...character, agent: { ...character.agent, action } };
}

function noRandom(): number {
  throw new Error('no random draw expected');
}

/** A frame at `now` ms against `cast`; no random draw is expected unless `random` is given. */
function at(now: number, cast: readonly Character[], random: () => number = noRandom): Frame {
  return { now, cast, random };
}

/** Sets each action at its frame time in turn, deciding after each one. */
function play(character: Character, actions: readonly [number, string][]): Character {
  return actions.reduce((c, [now, action]) => followActivity(doing(c, action), at(now, [c])), character);
}

/** An editor that walked to its desk and sat down at 1000 ms. */
function seatedEditor(): Character {
  const walked = walk(followActivity(newcomer('alpha', 'Editing x.ts'), at(0, [])));
  return followActivity(walked, at(1000, [walked]));
}

function moving(character: Character): boolean {
  return character.x !== character.targetX || character.y !== character.targetY;
}

function isSpotTile(point: Point): boolean {
  return SPOTS.some((spot) => spot.x === point.x && spot.y === point.y);
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
  for (let i = 0; i < 40000 && moving(walker); i++) {
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
    expect(placeFor({ status: 'working', action })).toBe(place);
  });

  it('sends a working agent with no action yet (always so for Antigravity) to a desk', () => {
    expect(placeFor({ status: 'working', action: undefined })).toBe('desk');
  });

  it('sends a stopped agent to the lounge, whatever its last action', () => {
    expect(placeFor({ status: 'stopped', action: undefined })).toBe('lounge');
    expect(placeFor({ status: 'stopped', action: 'Reading x.ts' })).toBe('lounge');
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

  it('can reach every spot from the door as a path goal', () => {
    for (const spot of SPOTS) {
      const path = findPath(DOOR, spot);
      expect(path.at(-1)).toEqual({ x: spot.x, y: spot.y });
      expectValidPath(DOOR, path);
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

describe('wandering', () => {
  it('picks reachable tiles off every spot, varying with the roll', () => {
    const cast = fill('shelf', 'Reading x.ts');
    const late = newcomer('late', 'Reading y.ts');
    const rolls = Array.from({ length: 40 }, (_, i) => (i + 0.5) / 40);
    const targets = rolls.map((roll) => {
      const wandering = pickTarget(late, () => roll, cast);
      const target = { x: wandering.targetX, y: wandering.targetY };
      expect(wandering.spot).toBeUndefined();
      expect(isSpotTile(target)).toBe(false);
      expect(wandering.path.at(-1)).toEqual(target);
      expectValidPath(DOOR, wandering.path);
      return `${String(target.x)},${String(target.y)}`;
    });
    expect(new Set(targets).size).toBe(rolls.length);
  });
});

describe('re-targeting', () => {
  it('sends a newcomer straight to a spot for its activity', () => {
    const editor = followActivity(newcomer('alpha', 'Editing x.ts'), at(0, []));
    expect(editor.place).toBe('desk');
    expect(editor.spot?.kind).toBe('desk');
    expect({ x: editor.targetX, y: editor.targetY }).toEqual({ x: editor.spot?.x, y: editor.spot?.y });
    expect(editor.state).toBe('walking');
    expectValidPath(DOOR, editor.path);
  });

  it('sends a working agent with no action yet to a desk', () => {
    expect(followActivity(newcomer('ag', undefined, 'working'), at(0, [])).spot?.kind).toBe('desk');
  });

  it('records the arrival at a spot once, then holds it with no search while the kind is unchanged', () => {
    const walked = walk(followActivity(newcomer('alpha', 'Editing x.ts'), at(0, [])));
    const arrived = followActivity(walked, at(1000, [walked]));
    expect(arrived.arrivedAt).toBe(1000);
    expect(arrived.state).toBe('idle');
    expect(followActivity(arrived, at(2000, [arrived]))).toBe(arrived);
    const running = doing(arrived, 'Running npm test');
    expect(followActivity(running, at(999_999, [running]))).toBe(running);
  });

  it(`stays ${String(DWELL_MS)} ms at a spot before a settled change of kind moves it, without crossing furniture`, () => {
    expect(DWELL_MS).toBe(5000);
    const seated = seatedEditor();
    // Settled at 4500, but the dwell holds it until 6000.
    const reading = play(seated, [[1500, 'Reading x.ts']]);
    expect(play(reading, [[1000 + DWELL_MS - 1, 'Reading x.ts']]).spot).toBe(seated.spot);
    const moved = play(reading, [[1000 + DWELL_MS, 'Reading x.ts']]);
    expect(moved.place).toBe('shelf');
    expect(moved.spot?.kind).toBe('shelf');
    expect(moved.arrivedAt).toBeUndefined();
    expect(moved.path.at(-1)).toEqual({ x: moved.spot?.x, y: moved.spot?.y });
    expectValidPath(seated, moved.path);
    walk(moved);
  });

  it(`re-targets a walking character once the new kind has held ${String(PLACE_SETTLE_MS)} ms`, () => {
    expect(PLACE_SETTLE_MS).toBe(3000);
    let editor = followActivity(newcomer('alpha', 'Editing x.ts'), at(0, []));
    for (let i = 0; i < 150; i++) {
      editor = step(editor, 5);
    }
    expect(moving(editor)).toBe(true);
    const reading = play(editor, [[1, 'Reading x.ts']]);
    expect(play(reading, [[PLACE_SETTLE_MS, 'Reading x.ts']]).spot).toBe(editor.spot);
    const moved = play(reading, [[1 + PLACE_SETTLE_MS, 'Reading x.ts']]);
    expect(moved.spot?.kind).toBe('shelf');
    expect([walk(moved).x, walk(moved).y]).toEqual([moved.spot?.x, moved.spot?.y]);
  });

  it(`ignores a change of kind that lasts under ${String(PLACE_SETTLE_MS)} ms, walking or seated`, () => {
    const walking = followActivity(newcomer('alpha', 'Editing x.ts'), at(0, []));
    const seated = seatedEditor();
    // Each flip back restarts the count: the last change to Reading is the one that must hold.
    for (const [character, start] of [
      [walking, 100],
      [seated, 7000],
    ] as const) {
      const flips: [number, string][] = [
        [start, 'Reading x.ts'],
        [start + 2000, 'Editing x.ts'],
        [start + 2500, 'Reading x.ts'],
      ];
      const settling = play(character, [...flips, [start + 2500 + PLACE_SETTLE_MS - 1, 'Reading x.ts']]);
      expect(settling.spot).toBe(character.spot);
      expect(play(settling, [[start + 2500 + PLACE_SETTLE_MS, 'Reading x.ts']]).spot?.kind).toBe('shelf');
    }
  });

  it('restarts the settle when the wanted kind changes again before it settles', () => {
    // Reading from 7000, then Delegating from 9000: the meeting needs its own 3 s, until 12000.
    const delegating = play(seatedEditor(), [
      [7000, 'Reading x.ts'],
      [9000, 'Delegating to explorer'],
    ]);
    expect(play(delegating, [[9000 + PLACE_SETTLE_MS - 1, 'Delegating to explorer']]).spot?.kind).toBe('desk');
    expect(play(delegating, [[9000 + PLACE_SETTLE_MS, 'Delegating to explorer']]).spot?.kind).toBe('meeting');
  });

  it('places a newcomer or a returning character at once, and leaves at once mid-settle', () => {
    expect(followActivity(newcomer('beta', 'Reading x.ts'), at(0, [])).spot?.kind).toBe('shelf');
    const settling = play(seatedEditor(), [[9000, 'Reading x.ts']]);
    const leaving = reconcile([settling], [])[0];
    expect(leaving.state).toBe('leaving');
    expect(followActivity(leaving, at(20_000, [leaving]))).toBe(leaving);
    const back = reconcile([leaving], [settling.agent])[0];
    expect(followActivity(back, at(20_001, [back])).spot?.kind).toBe('shelf');
  });

  it('does not re-search for a walking wanderer whose kind is still full', () => {
    const cast = fill('shelf', 'Reading x.ts');
    const wandering = pickTarget(newcomer('late', 'Reading y.ts'), () => 0.5, cast);
    const stillReading = doing(wandering, 'Searching for TODO');
    expect(followActivity(stillReading, at(0, [...cast, stillReading]))).toBe(stillReading);
  });

  it(`pauses a wanderer ${String(IDLE_PAUSE_MS)} ms on arrival, then tries for a spot again`, () => {
    const cast = fill('shelf', 'Reading x.ts');
    const walked = walk(pickTarget(newcomer('late', 'Reading y.ts'), () => 0.5, cast));
    const paused = followActivity(walked, at(1000, [...cast, walked]));
    expect(paused.arrivedAt).toBe(1000);
    expect(paused.state).toBe('idle');
    expect(followActivity(paused, at(1000 + IDLE_PAUSE_MS - 1, [...cast, paused]))).toBe(paused);
    const onward = followActivity(
      paused,
      at(1000 + IDLE_PAUSE_MS, [...cast, paused], () => 0.25),
    );
    expect(onward.spot).toBeUndefined();
    expect(moving(onward)).toBe(true);
    const freed = followActivity(paused, at(1000 + IDLE_PAUSE_MS, [...cast.slice(1), paused]));
    expect(freed.spot).toBe(cast[0].spot);
  });

  it('re-targets a pausing wanderer at once when its kind changes', () => {
    const cast = fill('shelf', 'Reading x.ts');
    const walked = walk(pickTarget(newcomer('late', 'Reading y.ts'), () => 0.5, cast));
    const paused = followActivity(walked, at(1000, [...cast, walked]));
    const editing = doing(paused, 'Editing x.ts');
    expect(followActivity(editing, at(1001, [...cast, editing])).spot?.kind).toBe('desk');
  });

  it('lets leaving override the activity, and re-claims a spot on return', () => {
    const walked = walk(followActivity(newcomer('alpha', 'Editing x.ts'), at(0, [])));
    const seated = followActivity(walked, at(1000, [walked]));
    expect(seated.spot).toBeDefined();
    const leaving = reconcile([seated], [])[0];
    expect(leaving.state).toBe('leaving');
    expect(leaving.spot).toBeUndefined();
    expect(leaving.arrivedAt).toBeUndefined();
    expect(followActivity(leaving, at(1001, [leaving]))).toBe(leaving);
    const back = reconcile([leaving], [seated.agent])[0];
    const reseated = followActivity(back, at(1002, [back]));
    expect(reseated.spot).toBe(seated.spot);
    expectValidPath(back, reseated.path);
  });
});

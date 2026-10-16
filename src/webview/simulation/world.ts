// Map geometry AND layout. Pure data and predicates — no Phaser, no DOM (enforced by
// ESLint), so the whole office plan is unit-testable.
//
// The office is authored as ASCII art: 24 rows of 40 characters, one per tile. This is
// deliberate — a furnished, zoned map is what makes the space read as an office rather
// than a floor with people on it (the reference experience is Gather), and a designer can
// rearrange the whole floor here without touching a line of rendering code.

export const TILE_SIZE = 16;
export const MAP_TILES_X = 40;
export const MAP_TILES_Y = 24;

export const WORLD_WIDTH = MAP_TILES_X * TILE_SIZE;
export const WORLD_HEIGHT = MAP_TILES_Y * TILE_SIZE;

// # wall   . floor   , rug   D desk   C chair   T meeting table
// P plant  S sofa    K coffee counter  R printer/shelf   _ door
const OPEN_ROW = '#......................................#';

export const OFFICE_MAP: readonly string[] = [
  '########################################',
  '#..........#..........#................#',
  '#.DDDD.DDDD#.DDDD.DDDD#...TTTTTTTT.....#',
  '#.CCCC.CCCC#.CCCC.CCCC#...C......C.....#',
  '#......................#..C......C.....#',
  '#.DDDD.DDDD#.DDDD.DDDD#...TTTTTTTT.....#',
  '#.CCCC.CCCC#.CCCC.CCCC#...............P#',
  '#..........#..........#................#',
  OPEN_ROW,
  '#.P..................................P.#',
  OPEN_ROW,
  '#####.############.#####################',
  '#..........,,,,,,,.....................#',
  '#.KKKK.....,,,,,,,.................RRRR#',
  '#..........,,,,,,,.....................#',
  '#.SSSS.....,,,,,,,.....................#',
  '#..........,,,,,,,.................RRRR#',
  OPEN_ROW,
  '#.P..................................P.#',
  OPEN_ROW,
  OPEN_ROW,
  OPEN_ROW,
  '#..................__..................#',
  '########################################',
];

const WALKABLE = new Set(['.', ',', '_']);

export type TileKind = string;

export function tileAt(tx: number, ty: number): TileKind {
  return OFFICE_MAP[ty]?.[tx] ?? '#';
}

/** World-pixel coordinates → can a character stand here? Furniture is solid. */
export function isWalkable(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= WORLD_WIDTH || y >= WORLD_HEIGHT) {
    return false;
  }
  return WALKABLE.has(tileAt(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)));
}

/** Every standable tile, as world-pixel centres. Computed once — the map never changes. */
const WALKABLE_TILES: { x: number; y: number }[] = OFFICE_MAP.flatMap((row, ty) =>
  row
    .split('')
    .flatMap((tile, tx) =>
      WALKABLE.has(tile) ? [{ x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2 }] : [],
    ),
);

export function walkableTiles(): readonly { x: number; y: number }[] {
  return WALKABLE_TILES;
}

/** Where characters enter and leave — the '_' door tiles on the bottom wall. */
const DOOR_TILE_X = OFFICE_MAP[MAP_TILES_Y - 2].indexOf('_');
export const DOOR = {
  x: DOOR_TILE_X * TILE_SIZE + TILE_SIZE / 2,
  y: (MAP_TILES_Y - 2) * TILE_SIZE + TILE_SIZE / 2,
} as const;

/** Lower on screen draws in front. */
export function byDepth(a: { y: number }, b: { y: number }): number {
  return a.y - b.y;
}

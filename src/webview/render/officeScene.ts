// src/webview/render/officeScene.ts
// Phaser draws; it does not decide. Every position and state transition comes from
// `simulation/`, which is unit-tested without a browser. This file owns only textures,
// sprites, animations, canvas sizing and the frame loop.

// Phaser's typings name `ActiveXObject` (ParseXML's IE fallback), which lives in the
// ScriptHost lib rather than DOM; without it `tsc` fails inside node_modules.
/// <reference lib="scripthost" />

import Phaser from 'phaser';
import type { AgentView } from '../../officeTypes';
import { reconcile, SPRITE_VARIANTS, type Character } from '../simulation/population';
import { followActivity, step } from '../simulation/movement';
import { OFFICE_MAP, TILE_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from '../simulation/world';

const CHARACTER_FRAME = { frameWidth: 16, frameHeight: 24 };
const EMPTY_TILE = -1;
/** Smallest fit zoom: below this the office is unreadable, so it overflows (clipped) instead. */
const MIN_ZOOM = 0.5;
/** Defensive guard: setZoom re-enters fit() synchronously, so near-equal zooms must not loop. */
const ZOOM_EPSILON = 1e-6;

/** Map character → frame index in tiles.png, as recorded in resources/ASSETS.md. */
const TILE_FRAMES: Readonly<Partial<Record<string, number>>> = {
  '.': 0, // floor
  '#': 1, // wall
  ',': 2, // rug
  D: 3, // desk
  C: 4, // chair
  T: 5, // meeting table
  P: 6, // plant
  S: 7, // sofa
  K: 8, // coffee counter
  R: 9, // shelf / printer
  _: 10, // door
};

// characters.png (resources/ASSETS.md): 8 sets stacked vertically — sessions 0-3, subagents
// 4-7 — each with one row of 4 walk frames per direction. Frame = ((set*4)+dir)*4+frame.
const CHARACTER_SETS = 2 * SPRITE_VARIANTS;
const DIRECTIONS = 4;
const WALK_FRAMES = 4;
const DOWN = 0;
const LEFT = 1;
const RIGHT = 2;
const UP = 3;
// Matched to the walking speed (movement.ts, 0.035 px/ms): about 3.5 px per walk frame, the stride
// the cycle was tuned to at 0.02 px/ms and 6 fps. Change both together, or the feet slide.
const WALK_FRAME_RATE = 10;

/** One walk animation per set and direction, indexed by set * DIRECTIONS + direction. */
const WALK_KEYS: readonly string[] = Array.from(
  { length: CHARACTER_SETS * DIRECTIONS },
  (_, row) => `walk-${Math.floor(row / DIRECTIONS)}-${row % DIRECTIONS}`,
);

// A subagent is drawn slightly smaller than the session that launched it; a stopped agent
// fades; brand is a colour variation (spec §7), so Claude Code stays untinted.
const SUBAGENT_SCALE = 0.85;
const STOPPED_ALPHA = 0.55;
const ANTIGRAVITY_TINT = 0x9cc3ff;

export interface RenderedPosition {
  id: string;
  name: string;
  /** Pixels from the left edge of the `parent` passed to createOffice. */
  screenX: number;
  /** Pixels from the top edge of `parent`, at the top of the character's 16 px body. */
  screenY: number;
  action?: string;
}

function frameFor(kind: string): number {
  return TILE_FRAMES[kind] ?? EMPTY_TILE;
}

function spriteSet(character: Character): number {
  return character.sprite + (character.agent.kind === 'subagent' ? SPRITE_VARIANTS : 0);
}

/** The standing pose: first walk frame of the character's set in `direction`. */
function standingFrame(character: Character, direction: number): number {
  return (spriteSet(character) * DIRECTIONS + direction) * WALK_FRAMES;
}

/** Direction faced while walking: the dominant axis of the remaining movement. */
function facing(dx: number, dy: number): number {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx < 0 ? LEFT : RIGHT;
  }
  return dy < 0 ? UP : DOWN;
}

/** Stand at a claimed spot facing its furniture; elsewhere, on the first frame of the direction last walked. */
function stand(sprite: Phaser.GameObjects.Sprite, character: Character): void {
  if (sprite.anims.isPlaying) {
    sprite.anims.pause(sprite.anims.currentAnim?.frames[0]);
  }
  if (character.spot) {
    // Only called on arrival at the target, and a claimed spot is always the target.
    sprite.setFrame(standingFrame(character, facing(character.spot.face.x, character.spot.face.y)));
  }
}

export class OfficeScene extends Phaser.Scene {
  private cast: Character[] = [];
  private pending: AgentView[] = [];
  private readonly sprites = new Map<string, Phaser.GameObjects.Sprite>();
  private positionListener?: (positions: RenderedPosition[]) => void;
  // Canvas top-left relative to `parent`, refreshed whenever the Scale Manager resizes,
  // so the per-frame position report never forces a layout read.
  private canvasLeft = 0;
  private canvasTop = 0;
  // Monitoring off (spec §9): asked for by setActive(false), carried out by the next update().
  private sleepRequested = false;
  private asleep = false;

  constructor(
    private readonly assetsBaseUri: string,
    private readonly parent: HTMLElement,
  ) {
    super('office');
  }

  preload(): void {
    this.load.image('tiles', `${this.assetsBaseUri}/tiles.png`);
    this.load.spritesheet('characters', `${this.assetsBaseUri}/characters.png`, CHARACTER_FRAME);
  }

  create(): void {
    this.drawMap();
    this.createWalkAnimations();
    // The Scale Manager already watches the window and polls the parent's size in its own
    // step; RESIZE is our cue to re-fit. Its listeners are removed when the game is destroyed.
    this.scale.on(Phaser.Scale.Events.RESIZE, () => {
      this.fit();
    });
    this.fit();
  }

  /**
   * Paints the authored office once. Static: the map never changes at runtime, so this
   * runs in create() and is never touched again — only characters move. Two tilemap
   * layers instead of one image per tile keep the display list (and its per-frame depth
   * sort) down to the characters.
   */
  private drawMap(): void {
    // Floor goes down everywhere first, so furniture sits on a continuous floor instead of
    // a hole; the furniture layer, created second, draws above it. Both stay at depth 0,
    // below every character (depth = y > 0).
    const furniture = OFFICE_MAP.map((row) => Array.from(row, (kind) => (kind === '.' ? EMPTY_TILE : frameFor(kind))));
    const map = this.make.tilemap({ data: furniture, tileWidth: TILE_SIZE, tileHeight: TILE_SIZE });
    const tileset = map.addTilesetImage('tiles');
    if (!tileset) {
      return;
    }
    map.createBlankLayer('floor', tileset)?.fill(frameFor('.'));
    map.createLayer(0, tileset);
  }

  private createWalkAnimations(): void {
    WALK_KEYS.forEach((key, row) => {
      const start = row * WALK_FRAMES;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers('characters', { start, end: start + WALK_FRAMES - 1 }),
        frameRate: WALK_FRAME_RATE,
        repeat: -1,
      });
    });
  }

  /**
   * Fractional fit (deliberate change to spec §7's integer scale): the 640x384 world is scaled
   * to the largest zoom that fits the parent, at least MIN_ZOOM, centred by the Scale Manager.
   * `pixelArt` makes the canvas `image-rendering: pixelated`, so pixels stay sharp.
   */
  private fit(): void {
    const { width, height } = this.scale.parentSize;
    const zoom = Math.max(MIN_ZOOM, Math.min(width / WORLD_WIDTH, height / WORLD_HEIGHT));
    if (Math.abs(zoom - this.scale.zoom) > ZOOM_EPSILON) {
      // setZoom refreshes and emits RESIZE synchronously, re-entering fit() with the new
      // zoom, which then records the re-centred canvas position.
      this.scale.setZoom(zoom);
      return;
    }
    const canvas = this.game.canvas.getBoundingClientRect();
    const parent = this.parent.getBoundingClientRect();
    this.canvasLeft = canvas.left - parent.left;
    this.canvasTop = canvas.top - parent.top;
  }

  /** Current fractional zoom of the 640x384 world; overlays scale their offsets with it. */
  get zoom(): number {
    return this.scale.zoom;
  }

  /** Canvas top-left relative to `parent`, as of the last resize. */
  get canvasOrigin(): { left: number; top: number } {
    return { left: this.canvasLeft, top: this.canvasTop };
  }

  setAgents(agents: readonly AgentView[]): void {
    this.pending = [...agents];
  }

  /**
   * false: empty the office and stop the frame loop once that empty frame is drawn — a static
   * disabled state that costs no CPU. true: wake the loop again. The sleep itself happens in
   * update(), because `this.game` (and its loop) only exists once Phaser has booted the scene.
   */
  setActive(active: boolean): void {
    this.sleepRequested = !active;
    if (active && this.asleep) {
      this.asleep = false;
      this.game.loop.wake();
    }
  }

  onCharacterPositions(callback: (positions: RenderedPosition[]) => void): void {
    this.positionListener = callback;
  }

  update(time: number, delta: number): void {
    if (this.sleepRequested) {
      this.sleepLoop();
      return;
    }
    if (this.pending.length > 0 || this.cast.length > 0) {
      this.cast = reconcile(this.cast, this.pending);
    }
    // Advance a copy in place, so a spot claimed earlier this frame is already taken for the rest.
    // Every walking, waiting and re-targeting decision is the simulation's (followActivity).
    this.cast = [...this.cast];
    const frame = { now: time, cast: this.cast, random: Math.random };
    this.cast.forEach((character, index) => {
      this.cast[index] = followActivity(step(character, delta), frame);
    });
    this.syncSprites();
    this.emitPositions();
  }

  /** Drops every character and its overlays, then sleeps the loop after this frame renders. */
  private sleepLoop(): void {
    this.cast = [];
    this.pending = [];
    this.syncSprites();
    this.emitPositions();
    this.asleep = true;
    this.game.loop.sleep();
  }

  private syncSprites(): void {
    const alive = new Set(this.cast.map((c) => c.id));
    for (const [id, sprite] of this.sprites) {
      if (!alive.has(id)) {
        sprite.destroy();
        this.sprites.delete(id);
      }
    }
    for (const character of this.cast) {
      const sprite = this.sprites.get(character.id) ?? this.addSprite(character);
      sprite.setPosition(character.x, character.y);
      sprite.setDepth(character.y);
      sprite.setAlpha(character.agent.status === 'working' ? 1 : STOPPED_ALPHA);
      // Per frame, like alpha: a background agent switches between subagent (nested under its
      // launcher) and session (orphan) while on screen. The walk frames follow kind via spriteSet.
      sprite.setScale(character.agent.kind === 'subagent' ? SUBAGENT_SCALE : 1);
      this.animate(sprite, character);
    }
  }

  /** Brand never changes for an id, so the tint is set once; scale follows kind in syncSprites. */
  private addSprite(character: Character): Phaser.GameObjects.Sprite {
    // Feet on the character's point: the 16 px body sits bottom-aligned in the 24 px frame.
    const sprite = this.add
      .sprite(character.x, character.y, 'characters', standingFrame(character, DOWN))
      .setOrigin(0.5, 1);
    if (character.agent.brand === 'antigravity') {
      sprite.setTint(ANTIGRAVITY_TINT);
    }
    this.sprites.set(character.id, sprite);
    return sprite;
  }

  /** Walk toward the next waypoint (else the target), or stand. */
  private animate(sprite: Phaser.GameObjects.Sprite, character: Character): void {
    const waypoint = character.path.at(0);
    const dx = (waypoint?.x ?? character.targetX) - character.x;
    const dy = (waypoint?.y ?? character.targetY) - character.y;
    if (dx === 0 && dy === 0 && character.path.length === 0) {
      stand(sprite, character);
      return;
    }
    sprite.play(WALK_KEYS[spriteSet(character) * DIRECTIONS + facing(dx, dy)], true);
  }

  private emitPositions(): void {
    if (!this.positionListener) {
      return;
    }
    const zoom = this.scale.zoom;
    this.positionListener(
      this.cast.map((character) => ({
        id: character.id,
        name: character.agent.name,
        screenX: this.canvasLeft + character.x * zoom,
        screenY: this.canvasTop + (character.y - TILE_SIZE) * zoom,
        action: character.agent.status === 'working' ? character.agent.action : undefined,
      })),
    );
  }
}

export function createOffice(parent: HTMLElement, assetsBaseUri: string): OfficeScene {
  const scene = new OfficeScene(assetsBaseUri, parent);
  new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    pixelArt: true,
    backgroundColor: '#1e1e1e',
    // The office is slow-paced; half the default 60 fps halves the idle CPU cost. 31, not 30:
    // Phaser 3.90's stepLimitFPS fires once the summed (smoothed) frame deltas reach 1000/limit ms
    // and then drops the leftover, so at 30 two 60 Hz frames (~33.3 ms) land just under 33.33 ms
    // as often as over, and the loop judders between 20 and 30 fps. 32.26 ms clears every 2nd frame.
    fps: { limit: 31 },
    // No FIT: the world is scaled by our own zoom (see fit()).
    scale: { mode: Phaser.Scale.NONE, zoom: 1, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene,
  });
  return scene;
}

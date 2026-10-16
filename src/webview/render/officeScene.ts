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
import { pickTarget, step } from '../simulation/movement';
import { OFFICE_MAP, TILE_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from '../simulation/world';

const IDLE_PAUSE_MS = 1200;
const CHARACTER_FRAME = { frameWidth: 16, frameHeight: 24 };
const EMPTY_TILE = -1;

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
const WALK_FRAME_RATE = 6;

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

/** Direction faced while walking: the dominant axis of the remaining movement. */
function facing(dx: number, dy: number): number {
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx < 0 ? LEFT : RIGHT;
  }
  return dy < 0 ? UP : DOWN;
}

export class OfficeScene extends Phaser.Scene {
  private cast: Character[] = [];
  private pending: AgentView[] = [];
  private readonly sprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly pauseUntil = new Map<string, number>();
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
   * Integer zoom only (spec §7): the largest whole multiple of the 640x384 world that fits
   * the parent, at least 1, centred by the Scale Manager.
   */
  private fit(): void {
    const zoom = this.scale.getMaxZoom();
    if (zoom !== this.scale.zoom) {
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

  /** Current integer zoom of the 640x384 world; overlays scale their offsets with it. */
  get zoom(): number {
    return this.scale.zoom;
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
    this.cast = this.cast.map((character) => this.advance(character, time, delta));
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

  /** Walk; on arrival stand for IDLE_PAUSE_MS, then wander on. Leaving walks straight out. */
  private advance(character: Character, time: number, delta: number): Character {
    const moved = step(character, delta);
    if (moved.state === 'leaving' || moved.x !== moved.targetX || moved.y !== moved.targetY) {
      return moved;
    }
    const pausedUntil = this.pauseUntil.get(moved.id);
    if (pausedUntil === undefined) {
      this.pauseUntil.set(moved.id, time + IDLE_PAUSE_MS);
      return { ...moved, state: 'idle' };
    }
    if (time < pausedUntil) {
      return moved;
    }
    this.pauseUntil.delete(moved.id);
    return pickTarget(moved, Math.random);
  }

  private syncSprites(): void {
    const alive = new Set(this.cast.map((c) => c.id));
    for (const [id, sprite] of this.sprites) {
      if (!alive.has(id)) {
        sprite.destroy();
        this.sprites.delete(id);
        this.pauseUntil.delete(id);
      }
    }
    for (const character of this.cast) {
      const sprite = this.sprites.get(character.id) ?? this.addSprite(character);
      sprite.setPosition(character.x, character.y);
      sprite.setDepth(character.y);
      sprite.setAlpha(character.agent.status === 'working' ? 1 : STOPPED_ALPHA);
      this.animate(sprite, character);
    }
  }

  /** Kind and brand never change for an id, so scale and tint are set once. */
  private addSprite(character: Character): Phaser.GameObjects.Sprite {
    const standingDown = (spriteSet(character) * DIRECTIONS + DOWN) * WALK_FRAMES;
    // Feet on the character's point: the 16 px body sits bottom-aligned in the 24 px frame.
    const sprite = this.add.sprite(character.x, character.y, 'characters', standingDown).setOrigin(0.5, 1);
    if (character.agent.kind === 'subagent') {
      sprite.setScale(SUBAGENT_SCALE);
    }
    if (character.agent.brand === 'antigravity') {
      sprite.setTint(ANTIGRAVITY_TINT);
    }
    this.sprites.set(character.id, sprite);
    return sprite;
  }

  /** Walk toward the target, or stand on the first frame of the direction last walked. */
  private animate(sprite: Phaser.GameObjects.Sprite, character: Character): void {
    const dx = character.targetX - character.x;
    const dy = character.targetY - character.y;
    if (dx === 0 && dy === 0) {
      if (sprite.anims.isPlaying) {
        sprite.anims.pause(sprite.anims.currentAnim?.frames[0]);
      }
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
    // No FIT: the world is scaled by a whole-number zoom so pixels stay square (see fit()).
    scale: { mode: Phaser.Scale.NONE, zoom: Phaser.Scale.MAX_ZOOM, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene,
  });
  return scene;
}

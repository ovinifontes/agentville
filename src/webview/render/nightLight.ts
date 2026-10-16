// Day/night overlay: one tint rectangle over the map and furniture (below characters, so they
// stay bright and readable) plus soft additive glows on desk monitors. The tint itself is
// lighting.ts; this only paints it, and only when the local minute changes.

import Phaser from 'phaser';
import { lightingAt } from '../simulation/lighting';
import { OFFICE_MAP, TILE_SIZE, WORLD_HEIGHT, WORLD_WIDTH } from '../simulation/world';

// Above the tilemap layers (depth 0), below every character (depth = y, at least one tile). Multiply darkens
// the floor and furniture towards the tint colour without greying it.
const OVERLAY_DEPTH = 0.5;
const GLOW_DEPTH = 0.6;
const GLOW_COLOR = 0x7fd0ff;
const GLOW_MAX_ALPHA = 0.9;

export class NightLight {
  private readonly tint: Phaser.GameObjects.Rectangle;
  private readonly glow: Phaser.GameObjects.Graphics;
  private lastMinute = -1;

  constructor(scene: Phaser.Scene) {
    this.tint = scene.add
      .rectangle(0, 0, WORLD_WIDTH, WORLD_HEIGHT, 0, 0)
      .setOrigin(0)
      .setDepth(OVERLAY_DEPTH)
      .setBlendMode(Phaser.BlendModes.MULTIPLY);
    this.glow = scene.add.graphics().setDepth(GLOW_DEPTH).setBlendMode(Phaser.BlendModes.ADD);
    OFFICE_MAP.forEach((row, ty) => {
      Array.from(row).forEach((kind, tx) => {
        if (kind === 'D') {
          this.drawMonitorGlow(tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 3);
        }
      });
    });
  }

  /** Concentric discs approximate a soft falloff without a texture. */
  private drawMonitorGlow(x: number, y: number): void {
    [8, 6, 4].forEach((radius) => {
      this.glow.fillStyle(GLOW_COLOR, 0.07).fillCircle(x, y, radius);
    });
  }

  /** Call every frame: cheap unless the local minute changed. */
  update(now: Date): void {
    const minute = now.getHours() * 60 + now.getMinutes();
    if (minute === this.lastMinute) {
      return;
    }
    this.lastMinute = minute;
    const { color, alpha, screensGlow } = lightingAt(minute);
    this.tint.setFillStyle(color, alpha);
    this.glow.setAlpha(screensGlow * GLOW_MAX_ALPHA);
  }
}

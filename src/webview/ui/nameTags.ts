// src/webview/ui/nameTags.ts
// A small label under every character. Always visible, unlike the action bubble: an idle
// agent still needs to be identifiable.

import type { RenderedPosition } from '../render/officeScene';
import { pruneNodes } from './pruneNodes';
import { tagText } from './progressFormat';

// screenY is the head top; the 16 px body plus a 2 px gap puts the tag just under the feet.
// Characters are drawn at a fractional zoom, so the offset scales with it.
const BELOW_FEET_PX = 18;

export class NameTagLayer {
  private readonly nodes = new Map<string, HTMLDivElement>();

  private levels = new Map<string, number>();

  constructor(private readonly root: HTMLElement) {}

  /** Levels by agent id; call on every snapshot. Absent entries show the bare name. */
  setLevels(agents: readonly { id: string; level?: number }[]): void {
    this.levels = new Map(agents.flatMap((a) => (a.level === undefined ? [] : [[a.id, a.level] as const])));
  }

  render(positions: readonly RenderedPosition[], zoom: number): void {
    pruneNodes(this.nodes, new Set(positions.map((p) => p.id)));
    for (const position of positions) {
      let node = this.nodes.get(position.id);
      if (!node) {
        node = document.createElement('div');
        node.className = 'name-tag';
        this.root.appendChild(node);
        this.nodes.set(position.id, node);
      }
      const text = tagText(position.name, this.levels.get(position.id));
      if (node.textContent !== text) {
        node.textContent = text;
      }
      node.style.transform = `translate(${position.screenX}px, ${position.screenY + BELOW_FEET_PX * zoom}px) translateX(-50%)`;
    }
  }
}

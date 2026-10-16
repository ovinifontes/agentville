// src/webview/ui/bubbles.ts
// Speech bubbles are DOM, not canvas text: they inherit the VS Code theme, the text can be
// selected, and click handling is native. They are absolutely positioned over the canvas
// and repositioned every frame from the renderer's reported screen coordinates.

import type { RenderedPosition } from '../render/officeScene';
import { pruneNodes } from './pruneNodes';

const MAX_BUBBLE_CHARS = 40;
const GAP_PX = 4;

export class BubbleLayer {
  private readonly nodes = new Map<string, HTMLButtonElement>();

  constructor(
    private readonly root: HTMLElement,
    private readonly onClick: (agentId: string) => void,
  ) {}

  render(positions: readonly RenderedPosition[]): void {
    pruneNodes(this.nodes, new Set(positions.filter((p) => p.action).map((p) => p.id)));
    for (const position of positions) {
      if (!position.action) {
        continue;
      }
      let node = this.nodes.get(position.id);
      if (!node) {
        node = document.createElement('button');
        node.className = 'bubble';
        node.addEventListener('click', () => {
          this.onClick(position.id);
        });
        this.root.appendChild(node);
        this.nodes.set(position.id, node);
      }
      const text =
        position.action.length > MAX_BUBBLE_CHARS ? `${position.action.slice(0, MAX_BUBBLE_CHARS)}…` : position.action;
      if (node.textContent !== text) {
        node.textContent = text;
      }
      node.style.transform = `translate(${position.screenX}px, ${position.screenY - GAP_PX}px) translate(-50%, -100%)`;
    }
  }
}

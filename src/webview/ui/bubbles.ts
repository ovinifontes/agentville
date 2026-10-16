// src/webview/ui/bubbles.ts
// Speech bubbles are DOM, not canvas text: they inherit the VS Code theme, the text can be
// selected, and click handling is native. They are absolutely positioned over the canvas
// and repositioned every frame from the renderer's reported screen coordinates.

import type { RenderedPosition } from '../render/officeScene';
import { pruneNodes } from './pruneNodes';
import { layoutBubbles, type BubbleBox } from './bubbleLayout';

const MAX_BUBBLE_CHARS = 40;
const GAP_PX = 4;

export class BubbleLayer {
  private readonly nodes = new Map<string, HTMLButtonElement>();
  // Measured once per text change; the per-frame layout only reads these numbers.
  private readonly sizes = new Map<string, { width: number; height: number }>();

  constructor(
    private readonly root: HTMLElement,
    private readonly onClick: (agentId: string) => void,
  ) {}

  render(positions: readonly RenderedPosition[]): void {
    const working = positions.filter((p) => p.action);
    pruneNodes(this.nodes, new Set(working.map((p) => p.id)));
    for (const id of this.sizes.keys()) {
      if (!this.nodes.has(id)) {
        this.sizes.delete(id);
      }
    }
    const boxes: BubbleBox[] = [];
    for (const position of working) {
      const size = this.ensureNode(position.id, position.action ?? '');
      boxes.push({ id: position.id, x: position.screenX, bottom: position.screenY - GAP_PX, ...size });
    }
    const bottoms = layoutBubbles(boxes);
    for (const box of boxes) {
      const node = this.nodes.get(box.id);
      if (node) {
        node.style.transform = `translate(${box.x}px, ${bottoms.get(box.id) ?? box.bottom}px) translate(-50%, -100%)`;
      }
    }
  }

  /** Creates the node if needed and re-measures it only when its text changed. */
  private ensureNode(id: string, action: string): { width: number; height: number } {
    let node = this.nodes.get(id);
    if (!node) {
      node = document.createElement('button');
      node.className = 'bubble';
      node.addEventListener('click', () => {
        this.onClick(id);
      });
      this.root.appendChild(node);
      this.nodes.set(id, node);
    }
    const text = action.length > MAX_BUBBLE_CHARS ? `${action.slice(0, MAX_BUBBLE_CHARS)}…` : action;
    let size = this.sizes.get(id);
    if (node.textContent !== text || !size) {
      node.textContent = text;
      size = { width: node.offsetWidth, height: node.offsetHeight };
      this.sizes.set(id, size);
    }
    return size;
  }
}

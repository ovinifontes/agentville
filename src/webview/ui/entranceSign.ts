// "Entrance" label just below the door tiles, placed from the door's world position through
// the renderer's zoom and canvas offset. Styled like a name tag; never takes pointer events.

import { DOOR, TILE_SIZE } from '../simulation/world';

export class EntranceSign {
  private readonly node: HTMLDivElement;

  constructor(root: HTMLElement) {
    this.node = document.createElement('div');
    this.node.className = 'name-tag';
    this.node.textContent = 'Entrance';
    root.appendChild(this.node);
  }

  /** The door sits on the second-to-last row; the wall row below it is where the sign goes. */
  render(origin: { left: number; top: number }, zoom: number): void {
    const x = origin.left + DOOR.x * zoom;
    const y = origin.top + (DOOR.y + TILE_SIZE / 2) * zoom;
    this.node.style.transform = `translate(${x}px, ${y}px) translateX(-50%)`;
  }
}

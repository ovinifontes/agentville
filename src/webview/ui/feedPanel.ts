// src/webview/ui/feedPanel.ts
// Side panel showing one agent's recent activity. Content arrives as a bounded window from
// the extension; this file only renders it.

import type { FeedEntry } from '../../officeTypes';

export class FeedPanel {
  private readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly title: HTMLElement;
  private agentId: string | undefined;
  private name = '';

  constructor(
    root: HTMLElement,
    private readonly onClose: () => void,
  ) {
    this.element = document.createElement('aside');
    this.element.className = 'feed hidden';
    this.title = document.createElement('h2');
    this.list = document.createElement('div');
    this.list.className = 'feed-list';

    const close = document.createElement('button');
    close.textContent = 'Close';
    close.addEventListener('click', () => {
      this.close();
    });

    this.element.append(this.title, close, this.list);
    root.appendChild(this.element);
  }

  open(agentId: string, name: string): void {
    this.agentId = agentId;
    this.name = name;
    this.title.textContent = name;
    this.list.textContent = '';
    this.element.classList.remove('hidden');
  }

  /** Mark the open agent as finished when it is absent from the latest snapshot. */
  syncPresence(presentIds: readonly string[]): void {
    if (this.agentId === undefined) {
      return;
    }
    const finished = !presentIds.includes(this.agentId);
    this.title.textContent = finished ? `${this.name} · finished` : this.name;
  }

  close(): void {
    this.agentId = undefined;
    this.element.classList.add('hidden');
    this.onClose();
  }

  render(agentId: string, entries: readonly FeedEntry[]): void {
    if (agentId !== this.agentId) {
      return;
    }
    this.list.textContent = '';
    for (const entry of entries) {
      const item = document.createElement('article');
      item.className = `feed-entry feed-entry--${entry.role}`;
      const meta = document.createElement('span');
      meta.className = 'feed-meta';
      meta.textContent = entry.tool ?? entry.role;
      const body = document.createElement('pre');
      body.textContent = entry.text;
      item.append(meta, body);
      this.list.appendChild(item);
    }
    // The aside scrolls (.feed has overflow-y: auto); the list inside it never does.
    this.element.scrollTop = this.element.scrollHeight;
  }
}

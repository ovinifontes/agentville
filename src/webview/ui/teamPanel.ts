// src/webview/ui/teamPanel.ts
// Trophy button (top-left) toggling a panel with office XP, the type ranking and the
// achievements. Rendered with textContent only. It sits under the feed (z-index), which owns
// the right edge, so the two can be open together.

import type { ProgressView } from '../../officeTypes';
import { formatDuration, levelPercent } from './progressFormat';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function header(progress: ProgressView): HTMLElement[] {
  const next =
    progress.nextDecorXp === null ? 'All decorations unlocked' : `Next decoration at ${progress.nextDecorXp} XP`;
  return [el('h2', undefined, `Office XP ${progress.officeXp}`), el('div', 'team-meta', next)];
}

function ranking(progress: ProgressView): HTMLElement[] {
  const out = [el('h3', undefined, 'Ranking')];
  if (progress.rows.length === 0) out.push(el('div', 'team-meta', 'No XP yet.'));
  for (const row of progress.rows) {
    const item = el('div', 'team-row');
    const bar = el('div', 'team-bar');
    const fill = el('div');
    fill.style.width = `${levelPercent(row.xp, row.level, row.nextLevelXp)}%`;
    bar.appendChild(fill);
    item.append(
      el('strong', undefined, `${row.type} · Lv ${row.level}`),
      el('div', 'team-meta', `${row.xp} / ${row.nextLevelXp} XP · ${row.runs} runs · ${formatDuration(row.workMs)}`),
      bar,
    );
    out.push(item);
  }
  return out;
}

function achievements(progress: ProgressView): HTMLElement[] {
  const out = [el('h3', undefined, 'Achievements')];
  for (const a of progress.achievements) {
    const date = a.unlockedAt === undefined ? undefined : new Date(a.unlockedAt).toLocaleDateString();
    const item = el('div', date === undefined ? 'team-row locked' : 'team-row');
    item.append(
      el('strong', undefined, a.title),
      el('div', 'team-meta', date === undefined ? a.description : `Unlocked ${date}`),
    );
    out.push(item);
  }
  return out;
}

export class TeamPanel {
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;

  constructor(root: HTMLElement) {
    this.button = el('button', 'team-button hidden', '🏆');
    this.button.type = 'button';
    this.button.title = 'Team progress';
    this.button.setAttribute('aria-label', 'Team progress');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.addEventListener('click', () => {
      this.toggle(this.panel.classList.contains('hidden'));
    });

    this.panel = el('section', 'team-panel hidden');
    this.panel.setAttribute('aria-label', 'Team progress');
    this.body = el('div');
    this.panel.appendChild(this.body);
    this.panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.toggle(false);
        this.button.focus();
      }
    });
    root.append(this.button, this.panel);
  }

  render(progress: ProgressView): void {
    this.button.classList.toggle('hidden', !progress.enabled);
    if (!progress.enabled) {
      this.toggle(false);
      return;
    }
    this.body.replaceChildren(...header(progress), ...ranking(progress), ...achievements(progress));
  }

  private toggle(open: boolean): void {
    this.panel.classList.toggle('hidden', !open);
    this.button.setAttribute('aria-expanded', String(open));
  }
}

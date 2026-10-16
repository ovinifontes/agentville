// src/webview/ui/toasts.ts
// Achievement toasts: stacked, non-interactive, ~4 s each. Each id shows once per webview;
// a batch of new ids is acknowledged to the extension as soon as it is shown.

import type { AchievementView } from '../../officeTypes';

const TOAST_MS = 4000;

export class ToastLayer {
  private readonly element: HTMLElement;
  private readonly seen = new Set<string>();

  constructor(
    root: HTMLElement,
    private readonly onShown: (ids: string[]) => void,
  ) {
    this.element = document.createElement('div');
    this.element.className = 'toasts';
    root.appendChild(this.element);
  }

  show(achievements: readonly AchievementView[], toastIds: readonly string[]): void {
    const fresh = toastIds.filter((id) => !this.seen.has(id));
    for (const id of fresh) {
      this.seen.add(id);
      const achievement = achievements.find((a) => a.id === id);
      if (!achievement) continue;
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.setAttribute('role', 'status');
      const title = document.createElement('strong');
      title.textContent = `Achievement unlocked: ${achievement.title}`;
      const text = document.createElement('div');
      text.textContent = achievement.description;
      toast.append(title, text);
      this.element.appendChild(toast);
      setTimeout(() => {
        toast.remove();
      }, TOAST_MS);
    }
    if (fresh.length > 0) {
      this.onShown(fresh);
    }
  }

  clear(): void {
    this.element.textContent = '';
  }
}

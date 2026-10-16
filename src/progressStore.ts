// src/progressStore.ts
// VS Code glue for office progression (spec G1, G9): keeps the progress state in globalState,
// advances it on every provider refresh and feeds the office. No timer of its own besides the
// coalesced save, so a closed office costs nothing extra. Never throws.

import * as vscode from 'vscode';
import { applyTick, freshState, migrate, type ProgressState } from './progressRules';
import { toProgressView } from './progressView';
import { logDebug } from './logger';
import type { ProgressView } from './officeTypes';
import type { SessionTreeDataProvider } from './sessionTreeDataProvider';

export const PROGRESSION_SETTING = 'agentville.progression.enabled';
const STATE_KEY = 'progress';
const SAVE_DELAY_MS = 30_000;

function isProgressionEnabled(): boolean {
  return vscode.workspace.getConfiguration('agentville').get<boolean>('progression.enabled', true);
}

export class ProgressStore implements vscode.Disposable {
  private state: ProgressState;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires after every refresh tick, reset or setting change; the office re-posts `progress`. */
  readonly onDidChange = this.changed.event;
  private readonly subscription: vscode.Disposable;

  constructor(
    private readonly memento: vscode.Memento,
    private readonly provider: SessionTreeDataProvider,
  ) {
    this.state = this.load();
    this.subscription = provider.onDidChangeSessions(() => {
      this.tick();
    });
  }

  current(): ProgressView {
    return toProgressView(this.state, isProgressionEnabled());
  }

  /** The office showed these toasts; drop them from the queue. */
  markToastsShown(ids: readonly string[]): void {
    try {
      const shown = new Set(ids);
      this.state = { ...this.state, pendingToasts: this.state.pendingToasts.filter((id) => !shown.has(id)) };
      this.scheduleSave();
    } catch (error) {
      logDebug(`ProgressStore.markToastsShown failed: ${String(error)}`);
    }
  }

  reset(): void {
    this.state = freshState();
    this.save();
    this.changed.fire();
  }

  dispose(): void {
    this.subscription.dispose();
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.save();
    this.changed.dispose();
  }

  private load(): ProgressState {
    try {
      return migrate(this.memento.get(STATE_KEY));
    } catch (error) {
      logDebug(`ProgressStore.load failed: ${String(error)}`);
      return freshState();
    }
  }

  private tick(): void {
    if (isProgressionEnabled()) {
      try {
        const clock = { now: Date.now(), tzOffsetMinutes: new Date().getTimezoneOffset() };
        this.state = applyTick(this.state, this.provider.getSessions(), clock).state;
        this.scheduleSave();
      } catch (error) {
        logDebug(`ProgressStore.tick failed: ${String(error)}`);
      }
    }
    // Fired even with progression off, so an open office learns it and hides the layer.
    this.changed.fire();
  }

  /** At most one save per SAVE_DELAY_MS: later changes ride along with the pending one. */
  private scheduleSave(): void {
    this.saveTimer ??= setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, SAVE_DELAY_MS);
  }

  private save(): void {
    try {
      this.memento.update(STATE_KEY, this.state).then(undefined, (error: unknown) => {
        logDebug(`ProgressStore.save failed: ${String(error)}`);
      });
    } catch (error) {
      logDebug(`ProgressStore.save failed: ${String(error)}`);
    }
  }
}

// src/progressStore.ts
// VS Code glue for office progression (spec G1, G9; ruling R5). Progress is one JSON file in the
// extension's global storage, shared by every window: the window holding the lease accrues from
// all projects' sessions and is the only writer of that file; the others re-read it on their own
// refresh ticks and send resets and toast acknowledgements as request files (progressSync.ts).
// Driven by the provider's refresh ticks; the only timer is the coalesced save. Never throws.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { applyTick, pauseProgress } from './progressRules';
import {
  applyRequests,
  docKey,
  emptyDoc,
  leaseRole,
  listRequests,
  parseDoc,
  parseLease,
  parseRequest,
  readText,
  removeFile,
  writeAtomic,
  type Lease,
  type ProgressDoc,
  type ProgressRequest,
} from './progressSync';
import { toProgressView } from './progressView';
import { logDebug } from './logger';
import type { ProgressView } from './officeTypes';
import type { SessionTreeDataProvider } from './sessionTreeDataProvider';

export const PROGRESSION_SETTING = 'agentville.progression.enabled';
const SAVE_DELAY_MS = 30_000;

function isProgressionEnabled(): boolean {
  return vscode.workspace.getConfiguration('agentville').get<boolean>('progression.enabled', true);
}

export class ProgressStore implements vscode.Disposable {
  private readonly id = randomUUID();
  private readonly docFile: string;
  private readonly leaseFile: string;
  private doc: ProgressDoc;
  private holding = false;
  private savedKey = '';
  private requestSeq = 0;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly changed = new vscode.EventEmitter<void>();
  /** Fires after every live refresh tick, reset or setting change; the office re-posts `progress`. */
  readonly onDidChange = this.changed.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(
    private readonly dir: string,
    private readonly provider: SessionTreeDataProvider,
  ) {
    this.docFile = path.join(dir, 'progress.json');
    this.leaseFile = path.join(dir, 'lease.json');
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
      logDebug(`ProgressStore: cannot create ${dir}: ${String(error)}`);
    }
    this.doc = this.readDoc() ?? emptyDoc();
    this.subscriptions = [
      provider.onDidChangeSessions(() => {
        this.tick();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(PROGRESSION_SETTING)) this.changed.fire();
      }),
    ];
  }

  current(): ProgressView {
    return toProgressView(this.doc.state, isProgressionEnabled());
  }

  /** The office showed these toasts. */
  markToastsShown(ids: readonly string[]): void {
    this.request({ kind: 'ack', generation: this.doc.generation, ids });
  }

  reset(): void {
    this.request({ kind: 'reset', generation: this.doc.generation + 1 });
    this.changed.fire();
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    clearTimeout(this.saveTimer);
    if (this.holding) {
      // Synchronous, so a restart resumes from exactly here; releasing lets the next window take over now.
      this.save();
      if (this.readLease()?.holder === this.id) removeFile(this.leaseFile);
    }
    this.changed.dispose();
  }

  /** The holder applies it and saves at once; a follower files it for the holder and shows its effect meanwhile. */
  private request(request: ProgressRequest): void {
    const before = this.doc;
    try {
      this.doc = applyRequests(before, [request]);
      if (this.holding && this.save()) return;
      const name = `req-${this.id}-${String(Date.now())}-${String(++this.requestSeq)}.json`;
      // Unsent, the request must not leave this window showing a state the holder will never write.
      if (!writeAtomic(path.join(this.dir, name), JSON.stringify(request), this.id)) this.doc = before;
    } catch (error) {
      logDebug(`ProgressStore.request failed: ${String(error)}`);
    }
  }

  private tick(): void {
    // A loading [] or monitoring-off [] would make the first tick seed nothing (spec G2, ruling R3).
    if (!this.provider.isLive()) return;
    try {
      const now = Date.now();
      if (this.syncLease(now)) {
        this.consumeRequests();
        this.advance(now);
      } else {
        this.follow();
      }
    } catch (error) {
      logDebug(`ProgressStore.tick failed: ${String(error)}`);
    }
    this.changed.fire();
  }

  /** True when this window holds the lease after the call. */
  private syncLease(now: number): boolean {
    const text = readText(this.leaseFile);
    if (text === null) return false; // never claim a lease that cannot be read
    const role = leaseRole(parseLease(text), this.id, now);
    if (role === 'follow') return false;
    if (role !== 'hold' && !this.writeLease(now)) return false;
    // Two windows can claim a stale lease at once; the rename that landed last wins.
    if (role === 'take' && this.readLease()?.holder !== this.id) return false;
    // After a takeover, memory may be older than the file another holder wrote meanwhile.
    if (this.holding && role !== 'take') return true;
    return this.takeOver();
  }

  /** Start from the file (state, counted ids, generation); the 60 s credit cap bounds the gap. */
  private takeOver(): boolean {
    const doc = this.readDoc();
    if (!doc) return false;
    this.doc = doc;
    this.savedKey = docKey(doc);
    this.holding = true;
    logDebug(`ProgressStore: window ${this.id} holds the progress lease`);
    return true;
  }

  private follow(): void {
    if (this.holding) {
      this.holding = false;
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    const onDisk = this.readDoc();
    // A reset this window requested stays visible until the holder has written it.
    if (onDisk && onDisk.generation >= this.doc.generation) this.doc = onDisk;
  }

  /** Apply other windows' requests, save, then delete them: a crash in between re-applies them (idempotent). */
  private consumeRequests(): void {
    const read = listRequests(this.dir)
      .map((name) => ({ file: path.join(this.dir, name), text: readText(path.join(this.dir, name)) }))
      .filter((r): r is { file: string; text: string } => r.text !== null);
    if (read.length === 0) return;
    const requests = read.map((r) => parseRequest(r.text)).filter((r): r is ProgressRequest => r !== null);
    this.doc = applyRequests(this.doc, requests);
    if (!this.save()) return;
    for (const r of read) removeFile(r.file);
  }

  private advance(now: number): void {
    const clock = { now, tzOffsetMinutes: new Date(now).getTimezoneOffset() };
    const state = isProgressionEnabled()
      ? applyTick(this.doc.state, this.provider.getAllSessions(), clock).state
      : pauseProgress(this.doc.state);
    this.doc = { ...this.doc, state };
    if (docKey(this.doc) !== this.savedKey) this.scheduleSave();
  }

  /** At most one tick-driven save per SAVE_DELAY_MS: later changes ride along with the pending one. */
  private scheduleSave(): void {
    this.saveTimer ??= setTimeout(() => {
      this.saveTimer = undefined;
      if (this.holding) this.save();
    }, SAVE_DELAY_MS);
  }

  /** Holder only. A newer generation on disk (a reset written by an overlapping holder) wins over memory. */
  private save(): boolean {
    // A window resumed from suspension may have lost the lease without having ticked yet.
    if (this.readLease()?.holder !== this.id) return false;
    const onDisk = this.readDoc();
    if (onDisk && onDisk.generation > this.doc.generation) {
      this.doc = onDisk;
      this.savedKey = docKey(onDisk);
      return true;
    }
    const ok = writeAtomic(this.docFile, JSON.stringify(this.doc), this.id);
    if (ok) this.savedKey = docKey(this.doc);
    return ok;
  }

  private writeLease(now: number): boolean {
    const lease: Lease = { holder: this.id, heartbeat: now };
    return writeAtomic(this.leaseFile, JSON.stringify(lease), this.id);
  }

  private readLease(): Lease | null {
    return parseLease(readText(this.leaseFile) ?? '');
  }

  private readDoc(): ProgressDoc | null {
    const text = readText(this.docFile);
    return text === null ? null : parseDoc(text);
  }
}

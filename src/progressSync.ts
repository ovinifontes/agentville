// src/progressSync.ts
// Sharing office progress between VS Code windows (spec G1, ruling R5). One progress file is
// written only by the window holding the lease; the others read it, and ask the holder for a
// reset or acknowledge toasts through one-shot request files. Decisions here are pure; the file
// helpers never throw. No vscode.

import * as fs from 'fs';
import { logDebug } from './logger';
import { freshState, migrate, type ProgressState } from './progressRules';

export const LEASE_STALE_MS = 90_000;
export const LEASE_RENEW_MS = 10_000;
export const REQUEST_PATTERN = /^req-.+\.json$/;

/** The progress file: the state plus a generation bumped by every reset. */
export interface ProgressDoc {
  generation: number;
  state: ProgressState;
}

export interface Lease {
  holder: string; // random id of the holding window
  heartbeat: number; // epoch ms of the last renewal
}

export type ProgressRequest =
  | { kind: 'ack'; generation: number; ids: readonly string[] } // toasts shown at that generation
  | { kind: 'reset'; generation: number }; // reset to this generation

/** hold: keep holding; renew: hold and rewrite the heartbeat; follow: read only; take: claim it. */
export type LeaseRole = 'hold' | 'renew' | 'follow' | 'take';

export function emptyDoc(): ProgressDoc {
  return { generation: 0, state: freshState() };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const isGeneration = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** Missing, partial or foreign content yields an empty doc; never throws. */
export function parseDoc(text: string): ProgressDoc {
  const raw = parseJson(text);
  if (!isRecord(raw)) return emptyDoc();
  return { generation: isGeneration(raw.generation) ? raw.generation : 0, state: migrate(raw.state) };
}

export function parseLease(text: string): Lease | null {
  const raw = parseJson(text);
  if (!isRecord(raw) || typeof raw.holder !== 'string' || typeof raw.heartbeat !== 'number') return null;
  return { holder: raw.holder, heartbeat: raw.heartbeat };
}

export function parseRequest(text: string): ProgressRequest | null {
  const raw = parseJson(text);
  if (!isRecord(raw) || !isGeneration(raw.generation)) return null;
  if (raw.kind === 'reset') return { kind: 'reset', generation: raw.generation };
  if (raw.kind !== 'ack' || !Array.isArray(raw.ids)) return null;
  return { kind: 'ack', generation: raw.generation, ids: raw.ids.filter((id): id is string => typeof id === 'string') };
}

export function leaseRole(lease: Lease | null, me: string, now: number): LeaseRole {
  const age = lease ? Math.abs(now - lease.heartbeat) : Infinity; // a heartbeat in the future is a moved clock
  if (lease?.holder === me) return age >= LEASE_RENEW_MS ? 'renew' : 'hold';
  return age > LEASE_STALE_MS ? 'take' : 'follow';
}

/** Resets win over acks; acks apply only to the generation whose toasts they saw. */
export function applyRequests(doc: ProgressDoc, requests: readonly ProgressRequest[]): ProgressDoc {
  const resetTo = Math.max(doc.generation, ...requests.map((r) => (r.kind === 'reset' ? r.generation : 0)));
  const base = resetTo > doc.generation ? { generation: resetTo, state: freshState() } : doc;
  const acked = new Set(requests.flatMap((r) => (r.kind === 'ack' && r.generation === base.generation ? r.ids : [])));
  if (acked.size === 0) return base;
  return { ...base, state: { ...base.state, pendingToasts: base.state.pendingToasts.filter((id) => !acked.has(id)) } };
}

/**
 * What must reach disk. Per-tick bookkeeping (lastTickAt, prevWorking, day total, peak) rides
 * along with the next real change; only whether the clock is paused counts on its own, so a
 * window taking over after progression was off seeds instead of crediting the gap.
 */
export function docKey(doc: ProgressDoc): string {
  const s = doc.state;
  const kept = [s.types, s.countedIds, s.completedTypes, s.totalRuns, s.achievements, s.pendingToasts];
  return JSON.stringify([doc.generation, ...kept, s.lastTickAt === null]);
}

/** File text; '' when the file does not exist; null when it exists but cannot be read. */
export function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return '';
    logDebug(`progressSync: cannot read ${file}: ${String(error)}`);
    return null;
  }
}

/**
 * Write through a temp file and a rename, so readers never see a partial file. The rename is
 * retried once (Windows can refuse it while another process reads the target). Never throws.
 */
export function writeAtomic(file: string, text: string, tag: string): boolean {
  const temp = `${file}.${tag}.tmp`;
  try {
    fs.writeFileSync(temp, text);
    try {
      fs.renameSync(temp, file);
    } catch (error) {
      logDebug(`progressSync: rename to ${file} failed, retrying: ${String(error)}`);
      fs.renameSync(temp, file);
    }
    return true;
  } catch (error) {
    logDebug(`progressSync: cannot write ${file}: ${String(error)}`);
    removeFile(temp);
    return false;
  }
}

export function removeFile(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch (error) {
    logDebug(`progressSync: cannot remove ${file}: ${String(error)}`);
  }
}

/** Names of pending request files in `dir`; [] when it cannot be listed. */
export function listRequests(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((name) => REQUEST_PATTERN.test(name));
  } catch (error) {
    logDebug(`progressSync: cannot list ${dir}: ${String(error)}`);
    return [];
  }
}

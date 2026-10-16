// src/progressSync.ts
// Sharing office progress between VS Code windows (spec G1, ruling R5). One progress file is
// written only by the window holding the lease; the others read it, and ask the holder for a
// reset or acknowledge toasts through one-shot request files. Decisions here are pure; the file
// helpers never throw. No vscode.

import * as fs from 'fs';
import * as path from 'path';
import { logDebug } from './logger';
import { freshState, migrate, SCHEMA_VERSION, type ProgressState } from './progressRules';

export const LEASE_STALE_MS = 90_000;
export const LEASE_RENEW_MS = 10_000;
export const STALE_TEMP_MS = 60_000;
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

/**
 * A progress file read (ruling R7): the doc, from the file or else its `.bak`; 'missing' when
 * neither exists; 'invalid' when what exists is not a valid doc; 'newer' when a newer schema wrote
 * it; 'error' when the file exists but cannot be read, so nothing may be assumed about it.
 */
export type DocRead = ProgressDoc | 'missing' | 'invalid' | 'newer' | 'error';

type FileRead = { kind: 'doc'; doc: ProgressDoc; text: string } | { kind: Exclude<DocRead, ProgressDoc> };

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
const isMissing = (error: unknown): boolean => isRecord(error) && error.code === 'ENOENT';

/** Valid = a `{ generation, state }` doc of this schema. Empty, partial or foreign text is invalid. */
function classify(text: string): FileRead {
  const raw = parseJson(text);
  const state = isRecord(raw) ? raw.state : undefined;
  if (!isRecord(raw) || !isGeneration(raw.generation) || !isRecord(state) || typeof state.version !== 'number') {
    return { kind: 'invalid' };
  }
  // Checked before migrate, which turns any other version into a fresh state.
  if (state.version > SCHEMA_VERSION) return { kind: 'newer' };
  if (state.version !== SCHEMA_VERSION) return { kind: 'invalid' };
  return { kind: 'doc', doc: { generation: raw.generation, state: migrate(state) }, text };
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
 * What must reach disk. Per-tick bookkeeping (lastTickAt, prevWorking, prevSessions, day total, peak) rides
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
    if (isMissing(error)) return '';
    logDebug(`progressSync: cannot read ${file}: ${String(error)}`);
    return null;
  }
}

function readFile(file: string): FileRead {
  try {
    return classify(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (isMissing(error)) return { kind: 'missing' };
    logDebug(`progressSync: cannot read ${file}: ${String(error)}`);
    return { kind: 'error' };
  }
}

const backupOf = (file: string): string => `${file}.bak`;

function resolve(file: string, main: FileRead): DocRead {
  if (main.kind === 'doc') return main.doc;
  if (main.kind === 'newer' || main.kind === 'error') return main.kind;
  const bak = readFile(backupOf(file));
  if (bak.kind === 'doc') return bak.doc;
  if (bak.kind === 'newer' || bak.kind === 'error') return bak.kind;
  return main.kind === 'missing' && bak.kind === 'missing' ? 'missing' : 'invalid';
}

/** The progress file, falling back to its `.bak` when it is missing or invalid. Never throws. */
export function readDoc(file: string): DocRead {
  return resolve(file, readFile(file));
}

/** Keeps a corrupt progress file for recovery and makes room for a fresh one (ruling R12). */
function quarantine(file: string, now: number): boolean {
  const kept = `${file}.corrupt-${String(now)}`;
  try {
    fs.renameSync(file, kept);
  } catch (error) {
    if (!isMissing(error)) {
      logDebug(`progressSync: cannot move ${file} aside: ${String(error)}`);
      return false;
    }
  }
  logDebug(`progressSync: no valid progress in ${file} or its backup; starting fresh (a bad file is kept as ${kept})`);
  return true;
}

/**
 * What a new holder starts from: the file or its `.bak`; a fresh doc when neither exists, or when
 * both are invalid once the bad file is moved aside. null when nothing is safe to start from (the
 * file is unreadable or from a newer schema, or the bad file could not be moved).
 */
export function loadForHolder(file: string, now: number): ProgressDoc | null {
  const read = readDoc(file);
  if (typeof read === 'object') return read;
  if (read === 'missing') return emptyDoc();
  return read === 'invalid' && quarantine(file, now) ? emptyDoc() : null;
}

/**
 * The holder's write. A newer generation on disk (a reset written by an overlapping holder) wins
 * over memory and is returned instead. A valid file is copied to `.bak` before it is replaced, so
 * the backup is always the last good save. null when nothing was written: the file cannot be read,
 * comes from a newer schema, or the write failed.
 */
export function saveDoc(file: string, doc: ProgressDoc, tag: string): ProgressDoc | null {
  const main = readFile(file);
  const onDisk = resolve(file, main);
  if (onDisk === 'newer' || onDisk === 'error') return null;
  if (typeof onDisk === 'object' && onDisk.generation > doc.generation) return onDisk;
  if (main.kind === 'doc') writeAtomic(backupOf(file), main.text, tag);
  return writeAtomic(file, JSON.stringify(doc), tag) ? doc : null;
}

/** Changes whenever the file is replaced (each atomic write lands a new inode); null when it cannot be stat'ed. */
export function fileSignature(file: string): string | null {
  try {
    const stat = fs.statSync(file);
    return `${String(stat.ino)}:${String(stat.mtimeMs)}:${String(stat.size)}`;
  } catch {
    return null;
  }
}

/** Temp files of a write that crashed before its rename (a live write's temp lasts microseconds). */
export function cleanStaleTemps(dir: string, now: number): void {
  try {
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))) {
      const file = path.join(dir, name);
      const stat = fs.statSync(file, { throwIfNoEntry: false });
      if (stat && now - stat.mtimeMs > STALE_TEMP_MS) removeFile(file);
    }
  } catch (error) {
    logDebug(`progressSync: cannot clean ${dir}: ${String(error)}`);
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

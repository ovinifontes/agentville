// src/progressRules.ts
// Pure game rules (spec G2-G5, G8): XP, levels, decoration thresholds, one tick of accrual.
// No vscode, no clock reads: `now` and the timezone offset are injected.

import { newlyMet } from './achievements';
import type { Session, SubAgent } from './types';

export const SCHEMA_VERSION = 1;
export const MAX_CREDIT_MS = 60_000;
export const RUN_XP = 10;
export const MAX_COUNTED_IDS = 2000;
export const DECOR_THRESHOLDS: readonly number[] = [100, 300, 600, 1000, 1500, 2200, 3000, 4000];
export const SESSION_TYPE = 'session';
export const BACKGROUND_TYPE = 'background agent';

export interface TypeStats {
  workMs: number; // Credited working time; 1 XP per full minute
  runs: number; // Completed subagent runs (10 XP each)
}

export interface ProgressState {
  version: number;
  types: Record<string, TypeStats>;
  countedIds: string[]; // Completed run ids already credited, oldest first, bounded
  completedTypes: string[]; // Distinct types with a completed run
  totalRuns: number;
  prevWorking: string[]; // Ids seen working at the previous tick
  lastTickAt: number | null;
  dayKey: string; // Local day, YYYY-MM-DD
  dayMs: number; // Working ms credited in dayKey
  peak: number; // Highest concurrent working subagents seen
  achievements: Record<string, number>; // id -> unlock timestamp
  pendingToasts: string[]; // Unlocked, not yet shown
}

/** `tzOffsetMinutes` follows Date.getTimezoneOffset(): UTC minus local, so UTC-3 is 180. */
export interface Clock {
  now: number;
  tzOffsetMinutes: number;
}

export interface TickResult {
  state: ProgressState;
  unlocked: string[];
}

export interface RankRow {
  type: string;
  xp: number;
  level: number;
  runs: number;
  workMs: number;
}

export function freshState(): ProgressState {
  return {
    version: SCHEMA_VERSION,
    types: {},
    countedIds: [],
    completedTypes: [],
    totalRuns: 0,
    prevWorking: [],
    lastTickAt: null,
    dayKey: '',
    dayMs: 0,
    peak: 0,
    achievements: {},
    pendingToasts: [],
  };
}

export function xpForLevel(n: number): number {
  return 25 * n * (n - 1);
}

export function levelFor(xp: number): number {
  let n = Math.max(1, Math.floor((1 + Math.sqrt(1 + xp / 6.25)) / 2));
  while (xpForLevel(n + 1) <= xp) n++;
  while (n > 1 && xpForLevel(n) > xp) n--;
  return n;
}

export function typeXp(stats: TypeStats): number {
  return Math.floor(stats.workMs / 60_000) + stats.runs * RUN_XP;
}

export function officeXp(state: ProgressState): number {
  return Object.values(state.types).reduce((sum, t) => sum + typeXp(t), 0);
}

/** Number of decoration items unlocked (ids 0..n-1) at this office XP. */
export function unlockedDecor(xp: number): number {
  return DECOR_THRESHOLDS.filter((t) => xp >= t).length;
}

export function rankTypes(state: ProgressState): RankRow[] {
  return Object.entries(state.types)
    .map(([type, s]) => ({ type, xp: typeXp(s), level: levelFor(typeXp(s)), runs: s.runs, workMs: s.workMs }))
    .sort((a, b) => b.xp - a.xp || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

interface Flat {
  id: string;
  type: string;
  working: boolean;
  stopped: boolean;
  isSub: boolean;
}

function typeOfSub(sub: SubAgent): string {
  if (sub.transcriptPath) return BACKGROUND_TYPE;
  return sub.name.trim().toLowerCase() || 'agent';
}

function flattenSub(sub: SubAgent): Flat[] {
  const self: Flat = {
    id: sub.id,
    type: typeOfSub(sub),
    working: sub.status === 'working',
    stopped: sub.status === 'stopped',
    isSub: true,
  };
  return [self, ...(sub.children ?? []).flatMap(flattenSub)];
}

function flatten(sessions: readonly Session[]): Flat[] {
  return sessions.flatMap((s) => [
    { id: s.id, type: SESSION_TYPE, working: s.status === 'working', stopped: false, isSub: false },
    ...s.subagents.flatMap(flattenSub),
  ]);
}

/** Each agent's type (spec G3) by id, exactly as accrual sees it. */
export function agentTypes(sessions: readonly Session[]): Map<string, string> {
  return new Map(flatten(sessions).map((f) => [f.id, f.type]));
}

function addStats(types: Record<string, TypeStats>, type: string, delta: TypeStats) {
  const cur = Object.hasOwn(types, type) ? types[type] : { workMs: 0, runs: 0 };
  // Computed key in a literal defines an own property, so a type named "__proto__" is safe.
  return { ...types, [type]: { workMs: cur.workMs + delta.workMs, runs: cur.runs + delta.runs } };
}

function localParts(clock: Clock): { dayKey: string; hour: number } {
  const local = new Date(clock.now - clock.tzOffsetMinutes * 60_000);
  return { dayKey: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

function accrue(state: ProgressState, flat: Flat[], now: number): ProgressState {
  if (state.lastTickAt === null) return state;
  const credit = Math.min(Math.max(now - state.lastTickAt, 0), MAX_CREDIT_MS);
  const prev = new Set(state.prevWorking);
  const earning = flat.filter((f) => f.working && prev.has(f.id));
  const types = earning.reduce((acc, f) => addStats(acc, f.type, { workMs: credit, runs: 0 }), state.types);
  return { ...state, types, dayMs: state.dayMs + credit * earning.length };
}

function creditRuns(state: ProgressState, stopped: Flat[]): ProgressState {
  const seen = new Set(state.countedIds);
  const fresh = stopped.filter((f, i) => !seen.has(f.id) && stopped.findIndex((g) => g.id === f.id) === i);
  const types = fresh.reduce((acc, f) => addStats(acc, f.type, { workMs: 0, runs: 1 }), state.types);
  const completed = new Set([...state.completedTypes, ...fresh.map((f) => f.type)]);
  return {
    ...state,
    types,
    countedIds: [...state.countedIds, ...fresh.map((f) => f.id)].slice(-MAX_COUNTED_IDS),
    completedTypes: [...completed],
    totalRuns: state.totalRuns + fresh.length,
  };
}

export function applyTick(state: ProgressState, sessions: readonly Session[], clock: Clock): TickResult {
  const { dayKey, hour } = localParts(clock);
  const flat = flatten(sessions);
  const base = state.dayKey === dayKey ? state : { ...state, dayKey, dayMs: 0 };
  const concurrent = flat.filter((f) => f.isSub && f.working).length;
  const next = creditRuns(
    accrue(base, flat, clock.now),
    flat.filter((f) => f.stopped),
  );
  const working = flat.filter((f) => f.working);
  const ticked: ProgressState = {
    ...next,
    prevWorking: working.map((f) => f.id),
    lastTickAt: clock.now,
    peak: Math.max(next.peak, concurrent),
  };
  const maxLevel = Math.max(1, ...rankTypes(ticked).map((r) => r.level));
  const unlocked = newlyMet(ticked, { hour, anyWorking: working.length > 0, concurrent, maxLevel });
  const stamps = Object.fromEntries(unlocked.map((id) => [id, clock.now]));
  return {
    state: {
      ...ticked,
      achievements: { ...ticked.achievements, ...stamps },
      pendingToasts: [...ticked.pendingToasts, ...unlocked],
    },
    unlocked,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const num = (v: unknown, min = 0): number => (typeof v === 'number' && Number.isFinite(v) && v >= min ? v : min);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function migrateTypes(v: unknown): Record<string, TypeStats> {
  if (!isRecord(v)) return {};
  return Object.entries(v).reduce<Record<string, TypeStats>>((acc, [k, s]) => {
    if (!isRecord(s)) return acc;
    return { ...acc, [k]: { workMs: num(s.workMs), runs: Math.floor(num(s.runs)) } };
  }, {});
}

function migrateAchievements(v: unknown): Record<string, number> {
  if (!isRecord(v)) return {};
  return Object.entries(v).reduce<Record<string, number>>(
    (acc, [k, t]) => (typeof t === 'number' && Number.isFinite(t) ? { ...acc, [k]: t } : acc),
    {},
  );
}

/** Any unrecognised input yields a valid fresh state; never throws. */
export function migrate(raw: unknown): ProgressState {
  try {
    if (!isRecord(raw) || raw.version !== SCHEMA_VERSION) return freshState();
    return {
      version: SCHEMA_VERSION,
      types: migrateTypes(raw.types),
      countedIds: strs(raw.countedIds).slice(-MAX_COUNTED_IDS),
      completedTypes: strs(raw.completedTypes),
      totalRuns: Math.floor(num(raw.totalRuns)),
      prevWorking: strs(raw.prevWorking),
      lastTickAt: typeof raw.lastTickAt === 'number' && Number.isFinite(raw.lastTickAt) ? raw.lastTickAt : null,
      dayKey: typeof raw.dayKey === 'string' ? raw.dayKey : '',
      dayMs: num(raw.dayMs),
      peak: Math.floor(num(raw.peak)),
      achievements: migrateAchievements(raw.achievements),
      pendingToasts: strs(raw.pendingToasts),
    };
  } catch {
    return freshState();
  }
}

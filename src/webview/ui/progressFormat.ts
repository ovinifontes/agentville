// Pure formatting for the team panel and name tags.

import { xpForLevel } from '../../progressRules';

const MAX_NAME_CHARS = 18;

/** `name · Lv N` (N >= 2; plain name at level 1): the name is cut to 18 chars, the level suffix always survives. */
export function tagText(name: string, level: number | undefined): string {
  const shown = name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS)}…` : name;
  return level === undefined || level < 2 ? shown : `${shown} · Lv ${level}`;
}

/** "45s", "12m", "2h 05m": coarse on purpose, working time only needs a feel. */
export function formatDuration(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** Share (0..100) of the way from this level's start XP to the next level's. */
export function levelPercent(xp: number, level: number, nextLevelXp: number): number {
  const start = xpForLevel(level);
  const span = nextLevelXp - start;
  if (span <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round(((xp - start) / span) * 100)));
}

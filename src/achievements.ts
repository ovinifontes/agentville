// src/achievements.ts
// The eight achievements (spec G5) as data plus a pure evaluator. No vscode, no clock reads.

/** The slice of ProgressState the conditions read (structural, so no import cycle). */
export interface AchievementInput {
  totalRuns: number;
  completedTypes: string[];
  dayMs: number;
  achievements: Record<string, number>;
}

export interface TickFacts {
  hour: number; // Local hour 0-23 at this tick
  anyWorking: boolean; // Any agent (session or subagent) working at this tick
  concurrent: number; // Working subagents (incl. grandchildren, background agents) at this tick
  maxLevel: number; // Highest agent-type level
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  met: (state: AchievementInput, facts: TickFacts) => boolean;
}

export const MARATHON_MS = 120 * 60_000;

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first-hire',
    title: 'First hire',
    description: 'A subagent finished its first run.',
    met: (s) => s.totalRuns >= 1,
  },
  {
    id: 'team-player',
    title: 'Team player',
    description: 'Five distinct subagent types completed a run.',
    met: (s) => s.completedTypes.length >= 5,
  },
  {
    id: 'full-house',
    title: 'Full house',
    description: 'Six or more subagents working at once.',
    met: (_s, f) => f.concurrent >= 6,
  },
  {
    id: 'night-owl',
    title: 'Night owl',
    description: 'An agent worked between 00:00 and 04:59.',
    met: (_s, f) => f.anyWorking && f.hour < 5,
  },
  {
    id: 'early-bird',
    title: 'Early bird',
    description: 'An agent worked between 05:00 and 06:59.',
    met: (_s, f) => f.anyWorking && f.hour >= 5 && f.hour < 7,
  },
  {
    id: 'marathon',
    title: 'Marathon',
    description: '120 working minutes in one day.',
    met: (s) => s.dayMs >= MARATHON_MS,
  },
  {
    id: 'century',
    title: 'Century',
    description: '100 completed subagent runs.',
    met: (s) => s.totalRuns >= 100,
  },
  {
    id: 'veteran',
    title: 'Veteran',
    description: 'An agent type reached level 5.',
    met: (_s, f) => f.maxLevel >= 5,
  },
];

/** Ids of achievements whose condition holds now and that are not yet unlocked. */
export function newlyMet(state: AchievementInput, facts: TickFacts): string[] {
  return ACHIEVEMENTS.filter((a) => !Object.hasOwn(state.achievements, a.id) && a.met(state, facts)).map((a) => a.id);
}

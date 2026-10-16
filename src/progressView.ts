// src/progressView.ts
// Maps the persisted progress state to the office's `progress` message (spec G6, data side).
// Pure: no vscode, no clock reads.

import { ACHIEVEMENTS } from './achievements';
import { DECOR_THRESHOLDS, officeXp, rankTypes, unlockedDecor, xpForLevel, type ProgressState } from './progressRules';
import type { AchievementView, ProgressView } from './officeTypes';

const KNOWN_IDS = new Set(ACHIEVEMENTS.map((a) => a.id));

function achievementViews(state: ProgressState): AchievementView[] {
  return ACHIEVEMENTS.map(({ id, title, description }) =>
    Object.hasOwn(state.achievements, id)
      ? { id, title, description, unlockedAt: state.achievements[id] }
      : { id, title, description },
  );
}

export function toProgressView(state: ProgressState, enabled: boolean): ProgressView {
  if (!enabled) {
    return { enabled: false, officeXp: 0, nextDecorXp: null, decor: [], rows: [], achievements: [], toasts: [] };
  }
  const xp = officeXp(state);
  const unlocked = unlockedDecor(xp);
  return {
    enabled: true,
    officeXp: xp,
    nextDecorXp: unlocked < DECOR_THRESHOLDS.length ? DECOR_THRESHOLDS[unlocked] : null,
    decor: Array.from({ length: unlocked }, (_, i) => i),
    rows: rankTypes(state).map((row) => ({ ...row, nextLevelXp: xpForLevel(row.level + 1) })),
    achievements: achievementViews(state),
    // Stored state may hold duplicates or ids from another version; the office gets each known one once.
    toasts: [...new Set(state.pendingToasts)].filter((id) => KNOWN_IDS.has(id)),
  };
}

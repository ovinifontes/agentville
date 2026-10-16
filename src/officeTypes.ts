// src/officeTypes.ts
// Wire format between the extension and the office webview. Shared by both bundles, so it
// must stay dependency-free — no `vscode`, no Phaser, no DOM.

export interface AgentView {
  id: string;
  kind: 'session' | 'subagent';
  parentId?: string;
  name: string;
  model?: string;
  projectName: string;
  brand: 'claude-code' | 'antigravity';
  status: 'working' | 'stopped';
  action?: string; // absent when stopped
  lastActivityAt: number;
  level?: number; // the agent type's level; absent when progression is disabled
}

export interface FeedEntry {
  role: 'assistant' | 'user';
  text: string; // truncated to MAX_ENTRY_CHARS
  tool?: string;
  at: number;
}

export interface ProgressRow {
  type: string; // agent type (spec G3)
  xp: number;
  level: number;
  nextLevelXp: number; // total XP at which the next level starts
  runs: number; // completed subagent runs
  workMs: number; // credited working time
}

export interface AchievementView {
  id: string;
  title: string;
  description: string;
  unlockedAt?: number; // epoch ms; absent while locked
}

export interface ProgressView {
  enabled: boolean; // false: hide the game layer; every list below is empty
  officeXp: number;
  nextDecorXp: number | null; // office XP that unlocks the next item; null when all are unlocked
  decor: number[]; // unlocked decoration ids, in order
  rows: ProgressRow[]; // ranked by XP, then type name
  achievements: AchievementView[]; // all eight, in definition order
  toasts: string[]; // achievement ids to toast now, in unlock order; ack with achievementsShown
}

export type ToWebview =
  | { type: 'snapshot'; agents: AgentView[]; truncated: number }
  | { type: 'feed'; agentId: string; entries: FeedEntry[] }
  | { type: 'progress'; progress: ProgressView }
  | { type: 'monitoringDisabled' };

export type ToExtension =
  | { type: 'ready' }
  | { type: 'openFeed'; agentId: string }
  | { type: 'closeFeed' }
  | { type: 'openLog'; agentId: string }
  | { type: 'openProject'; agentId: string }
  | { type: 'achievementsShown'; ids: string[] };

// src/officeSnapshot.ts
// Flattens the session tree into the flat cast of characters the office renders.
// Ordering and the visible cap live here (pure) rather than in the webview, so both are
// unit-tested and deterministic — the office must never reshuffle between refreshes.

import { agentTypes } from './progressRules';
import type { AgentView, ProgressView } from './officeTypes';
import type { Session, SubAgent } from './types';

export const MAX_VISIBLE_AGENTS = 24;

/**
 * A background agent (a session nested under its launcher — the only subagent with a
 * `transcriptPath`) is named 'Agent' by sessionAsSubagent, since the tree already shows its title
 * as the row's description. The office has only the name tag, which also picks the sprite, so it
 * uses the title — sessionAsSubagent's `task`, which falls back to the id when none was captured.
 */
function nameOf(subagent: SubAgent): string {
  if (!subagent.transcriptPath) {
    return subagent.name;
  }
  return subagent.task !== subagent.id ? subagent.task : 'background agent';
}

function subagentViews(session: Session, subagent: SubAgent, parentId: string): AgentView[] {
  const self: AgentView = {
    id: subagent.id,
    kind: 'subagent',
    parentId,
    name: nameOf(subagent),
    model: subagent.model ?? session.model,
    projectName: session.projectName,
    brand: session.type,
    status: subagent.status,
    lastActivityAt: session.lastInteractionTime,
  };
  // Grandchildren are parented to their own launcher, not to the session — nesting is
  // truncated at one level upstream, so this recursion is at most two deep.
  const children = (subagent.children ?? []).flatMap((child) => subagentViews(session, child, subagent.id));
  // A finished subagent is done for good, so it leaves the office (spec AC3). Sessions are
  // never dropped here: one reads 'stopped' between turns and stays as a dimmed idle character.
  return subagent.status === 'stopped' ? children : [self, ...children];
}

function sessionViews(session: Session): AgentView[] {
  const self: AgentView = {
    id: session.id,
    kind: 'session',
    name: session.sessionTitle ?? session.projectName,
    model: session.model,
    projectName: session.projectName,
    brand: session.type,
    status: session.status,
    lastActivityAt: session.lastInteractionTime,
  };
  return [self, ...session.subagents.flatMap((sub) => subagentViews(session, sub, session.id))];
}

/** Working first, then most recently active — stable, so the cast never oscillates. */
function byRelevance(a: AgentView, b: AgentView): number {
  if (a.status !== b.status) {
    return a.status === 'working' ? -1 : 1;
  }
  return b.lastActivityAt - a.lastActivityAt;
}

/** Each agent gets its type's level (spec G3/G4); a type with no XP yet is level 1. */
function withLevels(agents: AgentView[], sessions: readonly Session[], progress: ProgressView): AgentView[] {
  const types = agentTypes(sessions);
  const levels = new Map(progress.rows.map((row) => [row.type, row.level]));
  return agents.map((agent) => ({ ...agent, level: levels.get(types.get(agent.id) ?? '') ?? 1 }));
}

export function buildSnapshot(
  sessions: readonly Session[],
  actions: ReadonlyMap<string, string>,
  progress?: ProgressView,
): { agents: AgentView[]; truncated: number } {
  const views = sessions
    .flatMap(sessionViews)
    .map((agent) => (agent.status === 'working' ? { ...agent, action: actions.get(agent.id) } : agent));
  const all = (progress?.enabled ? withLevels(views, sessions, progress) : views).sort(byRelevance);

  return {
    agents: all.slice(0, MAX_VISIBLE_AGENTS),
    truncated: Math.max(0, all.length - MAX_VISIBLE_AGENTS),
  };
}

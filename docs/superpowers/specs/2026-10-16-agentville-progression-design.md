# AgentVille — Progression (sub-project 3)

**Status:** approved by the fork's owner on 2026-10-16 (delegated: "do it alone and deliver it ready"); implemented by `docs/superpowers/plans/2026-10-16-office-progression.md`.
**Builds on:** sub-project 1 (the office) and sub-project 2 (situated behaviour).

## Goal

Turn the office into a light game layer about the user's own agents: agent types earn XP and level up, the office celebrates milestones with achievements, a team panel ranks who worked the most, the light follows the real time of day, and the office collects decoration as the team grows. Everything is local, free and private.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| G1 | **Progress lives in the extension's `globalState`.** Schema-versioned JSON, one record per machine, never leaves the machine. Saved at most every 30 s and on deactivate. | The spec for sub-project 1 reserved persisted state for this sub-project; globalState survives restarts and needs no files. |
| G2 | **XP comes only from data the provider already has**, so a closed office still costs nothing extra: 1 XP per minute an agent is `working` (credited on refresh ticks, each credit capped at 60 s so sleep or long gaps never inflate it), and +10 XP each time a subagent run completes (its id is counted once; the counted-id set is bounded to the latest 2000). | No new scanning, no transcript reads for XP. Tool-level counters would need the office open, so they are out. |
| G3 | **Agent type** = the subagent's `name` (its agent type, lowercased and trimmed); top-level sessions are type `session`; background agents nested under a launcher are type `background agent`. | Matches what name tags show; stable across runs. |
| G4 | **Levels:** level n needs `25·n·(n−1)` XP (L2 = 50, L3 = 150, L5 = 500, L10 = 2250). Name tags show the type's level (`explorer-agent · Lv 3`). | A gentle curve: first levels in a day of work, later ones over weeks. |
| G5 | **Eight achievements**, each unlocked once and stamped with its time: *First hire* (first completed subagent run), *Team player* (5 distinct subagent types completed), *Full house* (6+ subagents working at once), *Night owl* (an agent working between 00:00 and 04:59 local), *Early bird* (an agent working between 05:00 and 06:59 local), *Marathon* (120 working minutes credited in one local day across all agents), *Century* (100 completed subagent runs), *Veteran* (any type reaches level 5). | Every condition is computable from G2's signals. |
| G6 | **Team panel** inside the office (a button in a corner): ranking of agent types by XP with level, XP to next level, completed runs and working time; the office XP and next decoration; the eight achievements, unlocked ones with their date. Unlocking an achievement while the office is open shows a small toast; unlocks that happen while it is closed are shown as toasts the next time it opens. No VS Code notifications. | Celebrates without interrupting work. |
| G7 | **Day/night follows the real local clock**, recomputed once a minute: day (07:00–17:00) unchanged; dusk (17:00–19:00) a warm tint rising; evening (19:00–21:00) turning blue; night (21:00–05:00) dark blue; dawn (05:00–07:00) fading back. At night the desk monitors glow softly. The tint is a pure function of the time, unit-tested. | Cheap (one overlay + a few light sprites) and readable. |
| G8 | **Unlockable decoration**: eight wall-mounted 16×16 CC0 items (e.g. clock, paintings, poster, whiteboard, window, trophy shelf) placed on wall tiles, unlocked in order as the **office XP** (sum of all types' XP) passes 100, 300, 600, 1000, 1500, 2200, 3000 and 4000. Wall-mounted only, so walkability and paths never change. | Visible progress without touching movement rules. |
| G9 | **Reset command** "AgentVille: Reset Office Progress" with a modal confirmation; a setting `agentville.progression.enabled` (default `true`) turns accrual and the game layer off. | User control. |
| G10 | **Boundaries stay**: XP rules, levels, achievements, lighting and decoration unlocks are pure modules with tests; the globalState store is VS Code glue; the webview only renders a `progress` message. | Same discipline as sub-projects 1 and 2. |

## Protocol additions

- `ToWebview` gains `{ type: 'progress'; progress: ProgressView }`, sent on open (after `ready`), on every change, and not while hidden. `ProgressView` carries the ranking rows, office XP, unlocked decoration ids, achievements (id, title, description, unlockedAt?) and the list of achievements to toast now.
- `AgentView` gains `level?: number` for name tags.

## Acceptance

1. Working agents and completed subagent runs earn XP as in G2; restarting VS Code keeps progress; the same run never counts twice.
2. Name tags show levels; the team panel ranks types correctly and shows achievements and the next decoration.
3. Each achievement unlocks exactly once under its condition and toasts once.
4. The light follows the local clock as in G7; monitors glow at night.
5. Decoration appears as office XP crosses each threshold and never blocks a path.
6. Reset clears everything after confirmation; disabling the setting stops accrual and hides the layer.
7. All pure modules unit-tested; gate green; `.vsix` stays under 2 MB with only CC0 art added.

# AgentVille — Office Progression (sub-project 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Spec:** `docs/superpowers/specs/2026-10-16-agentville-progression-design.md` (decisions G1-G10, binding).

## Global Constraints

- Repo lint gate (complexity 10, max-statements 20, max-lines-per-function 100, max-params 3, max-lines 355, typescript-eslint strictTypeChecked, prettier) and boundaries: pure modules import no `vscode`, no Phaser, no DOM; the webview never imports `vscode`; the extension never imports Phaser. New flat `src/*.ts` modules that import `vscode` must be added to `VSCODE_LAYER_MODULES` in `eslint.config.mjs` and to `coverage.exclude` in `vitest.config.ts`.
- Parsing and persistence never throw (wrap and `logDebug`).
- `npx tsc --noEmit`, `npm run lint`, `npm run test`, `npm run build`, `npm run test:coverage` (80/65/80/80) green before a task is done.
- Assets CC0 only, recorded in `resources/ASSETS.md`; `.vsix` < 2 MB.
- English strings and docs. README changes only in Task 7.

## Waves

- Wave 1 (parallel): Task 1 (assets, worktree), Task 2 (progress core), Task 4 (day/night, worktree).
- Wave 2: Task 3 (store + wiring; needs Task 2).
- Wave 3: Task 5 (decoration; needs Tasks 1, 3, 4), then Task 6 (team panel, toasts, level tags; needs Task 3).
- Wave 4: Task 7 (docs).

---

### Task 1: Decoration art

**Files:** `resources/office/decor.png`, `resources/ASSETS.md`, `resources/office/LICENSE-ASSETS.txt` (append provenance if new packs are used).
**Requirements (G8):** one row of exactly eight 16×16 RGBA wall-mounted items, transparent background, readable on the existing grey wall tile: 0 wall clock, 1 painting (landscape), 2 painting (portrait or abstract), 3 poster or chart, 4 whiteboard, 5 window, 6 trophy shelf or plaque, 7 a framed certificate or second shelf. Source only from CC0 packs (Kenney packs already downloaded under the session scratchpad `assets-work/dl/` and extracted under `assets-work/x/`; verify their licence files). Compose with Pillow via `uv run --with pillow`. Document the layout (index → item) and provenance in ASSETS.md. Produce a preview of the items drawn on the wall tile at 4x and check it by eye.
**Commit:** `chore: CC0 wall decoration sprites for office progression`

---

### Task 2: Progress core (pure)

**Files:** create `src/progressRules.ts` (types, XP accrual, levels, office XP, decoration unlock thresholds), `src/achievements.ts` (definitions + evaluation); tests `src/test/progressRules.test.ts`, `src/test/achievements.test.ts`.
**Requirements:** G2-G5 and G8's thresholds, exactly. A pure `applyTick(state, sessions, now)` returns the next state plus the ids of newly unlocked achievements: credits working minutes per agent type (capped 60 s per credit since the last tick; no credit on the first tick), +10 XP for each subagent run newly seen as completed (dedupe by id; bounded set of 2000, oldest dropped), tracks the local-day minute total (reset at local midnight; `now` and the timezone offset are injected, never read from globals), concurrency peak, and evaluates the eight achievements (each unlocked once with its timestamp). Helpers: `levelFor(xp)`, `xpForLevel(n)`, `officeXp(state)`, `unlockedDecor(officeXp)` (thresholds 100, 300, 600, 1000, 1500, 2200, 3000, 4000), `rankTypes(state)`. Include a schema `version` and a `migrate(unknown)` that returns a valid fresh state for anything unrecognised (never throws). Agent types per G3 (subagents nested via `transcriptPath` → `background agent`; top-level sessions → `session`; grandchildren count as their own type). TDD; cover every achievement boundary, the 60 s cap, dedupe, the bounded set, midnight rollover, and migrate.
**Commit:** `feat(progress): XP, levels and achievements rules`

---

### Task 3: Store and wiring

**Files:** create `src/progressStore.ts` (vscode glue); modify `src/extension.ts`, `src/officePanel.ts`, `src/officeTypes.ts` (`ProgressView`, `progress` message, `AgentView.level`), `src/officeSnapshot.ts` (attach levels by type), `package.json` (reset command, `agentville.progression.enabled` setting), `eslint.config.mjs`, `vitest.config.ts`; tests for any pure mapping (e.g. `toProgressView`).
**Requirements:** G1, G6 (data side), G9, G10. The tracker subscribes to the provider's `onDidChangeSessions` (no new timers beyond the debounced save), applies `applyTick`, persists to `globalState` (debounced ≤ 1 save per 30 s, plus on dispose), and exposes the current `ProgressView`. Pending toasts: newly unlocked achievements are queued in state until an open office has shown them (mark as shown when posted). The office posts `progress` after `ready`, on every tracker change while visible, never while hidden. Reset command asks with a modal and clears state. With the setting off: no accrual, office receives `progress` with an `enabled: false` flag (Task 5/6 hide the layer).
**Commit:** `feat(progress): persist progress and feed the office`

---

### Task 4: Day and night

**Files:** create `src/webview/simulation/lighting.ts` (pure: `lightingAt(minutesSinceMidnight) → { color, alpha, screensGlow }`), test `src/test/officeLighting.test.ts`; modify `src/webview/render/officeScene.ts` (an overlay over the map below characters' tags, and soft additive glows on desk monitor tiles at night), `src/webview/main.ts` only if needed to pass the local time.
**Requirements:** G7 exactly, smooth interpolation inside the transition windows, recomputed at most once per minute (no per-frame recompute), characters stay readable (overlay alpha ≤ 0.4). The time comes from the webview's local clock (`new Date()` is allowed in the renderer, not in the pure module, which takes minutes as input). Visual smoke screenshots at 12:00, 18:00, 20:00, 23:00.
**Commit:** `feat(office): day and night follow the local clock`

---

### Task 5: Decoration

**Files:** create `src/webview/simulation/decor.ts` (pure: decoration slots on wall tiles of `OFFICE_MAP`, eight slots matching Task 1's indices, chosen so each is visible and never on a door; which are shown for a given unlocked list); modify `src/webview/render/officeScene.ts` (load `decor.png`, draw unlocked items, update when the unlocked list changes) and `src/webview/main.ts` (pass the unlocked ids from the `progress` message); tests.
**Requirements:** G8. Walkability unchanged (assert in a test that every slot is a wall tile and that `walkableTiles()` is identical before and after). Items appear without reload when a threshold is crossed.
**Commit:** `feat(office): unlockable wall decoration`

---

### Task 6: Team panel, toasts and level tags

**Files:** create `src/webview/ui/teamPanel.ts`, `src/webview/ui/toasts.ts`; modify `src/webview/ui/nameTags.ts` (show `· Lv N` when a level is present), `src/webview/main.ts`, `src/officePanel.ts` (CSS only), plus a pure helper + test if formatting logic is non-trivial.
**Requirements:** G6 and acceptance 2-3. A small button (e.g. a trophy glyph) in a corner toggles the team panel; it must not overlap the feed panel, the `+N waiting` chip or the Entrance sign; keyboard accessible; textContent only. Toasts stack briefly (≈4 s each) and post `achievementsShown` (or equivalent) back so the extension marks them shown. Hidden entirely when progression is disabled.
**Commit:** `feat(office): team panel, achievement toasts and levels on name tags`

---

### Task 7: Docs

**Files:** `README.md`, spec status line.
**Requirements:** move Progression from Roadmap to Features describing what exists (XP sources, levels, achievements list, team panel, day/night, decoration thresholds, reset command and setting, privacy: stays on this machine). The Roadmap may then hold only future ideas or be removed if empty. Add the new setting and command to the Configuration/Usage sections.
**Commit:** `docs: office progression`

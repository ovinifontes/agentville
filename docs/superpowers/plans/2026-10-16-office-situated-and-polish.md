# AgentVille — Office: Situated Behaviour and Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Implement sub-project 2 (situated behaviour) and the polish items the fork's owner approved on 2026-10-16.

**Spec:** `docs/superpowers/specs/2026-10-16-agentville-situated-behaviour-design.md` (Task 1). Tasks 2-7 are small, self-contained improvements described here.

## Global Constraints

- Repo lint gate (complexity 10, max-statements 20, max-lines-per-function 100, max-params 3, max-lines 355, typescript-eslint strictTypeChecked, prettier) and boundary rules: `src/webview/simulation/**` pure (no Phaser, no DOM, no vscode); webview code never imports `vscode`; the extension never imports Phaser; `vscode` stays out of the parsing core.
- Parsing never throws; comment every transcript-format quirk; Claude Code and Antigravity both handled or explicitly no-op'd.
- `npx tsc --noEmit`, `npm run lint`, `npm run test`, `npm run build` and `npm run test:coverage` (80/65/80/80) green before a task is done. Existing tests keep passing; a test that pins behaviour a task intentionally replaces may change, and the report must say which and why.
- User-facing strings and docs are English. README changes happen only in Task 7.

## Waves

- Wave 1 (parallel, disjoint files): Task 1, Task 4, Task 6.
- Wave 2: Task 2 (after Task 1).
- Wave 3: Task 3, then Task 5 (both touch `src/officePanel.ts`; Task 5 also needs Task 4).
- Wave 4: Task 7.

---

### Task 1: Situated behaviour (sub-project 2)

**Files:** create `src/webview/simulation/situated.ts`; modify `src/webview/simulation/world.ts` (seats walkable per S3), `population.ts` (a character remembers its claimed spot and its kind), `movement.ts` (target choice delegates to situated selection; wandering stays the fallback), `src/webview/render/officeScene.ts` (ask for a new destination on arrival or when the activity's place kind changes; while standing at a spot, face the spot's direction); tests in a new `src/test/officeSituated.test.ts` (and adjust `officeSimulation.test.ts` / `officePathfinding.test.ts` only where seats becoming walkable changes a pinned fact).

**Requirements:** spec decisions S1-S6 and acceptance 1-5. Classification works on the action string's leading verb (`Reading`, `Searching for`, `Researching`, `Editing`, `Running`, `Planning`, `Thinking`, `Working`, `Delegating to`); an unknown string maps to desk. Keep `random` injected wherever randomness is used. Never search per frame.

**Commit:** `feat(office): characters go where their work is (situated behaviour)`

---

### Task 2: Office polish — 30 fps, bubbles that don't overlap, an entrance sign

**Files:** `src/webview/render/officeScene.ts` (game config), `src/webview/ui/bubbles.ts`, `src/webview/main.ts`, `src/officePanel.ts` (CSS only), optionally a new `src/webview/ui/` module.

**Requirements:**
- Cap the Phaser loop at 30 fps using the Phaser 3.90 `fps` game config (check the typings for `limit`/`target`).
- Bubbles never overlap each other: lay them out each frame with a simple greedy pass (e.g. process bubbles from bottom to top; if one would overlap an already placed bubble, lift it above that bubble). Measure a bubble's width only when its text changes, never with a layout read per frame per bubble beyond that cache. A lifted bubble stays visually tied to its character (a thin leader line or keeping x aligned is enough).
- An "Entrance" label is drawn just below the door (like a name tag, `pointer-events: none`), positioned from the door's world position through the renderer's current zoom and canvas offset, and it follows resizes.

**Commit:** `feat(office): 30 fps cap, non-overlapping bubbles and an entrance sign`

---

### Task 3: Keep the feed when its agent leaves

**Files:** `src/officePanel.ts`, `src/webview/ui/feedPanel.ts`, `src/webview/main.ts`.

**Requirements:** if the side panel is open for an agent that disappears from the snapshot (a finished subagent walking out), keep its last entries visible instead of emptying the panel, and mark the panel title as finished (e.g. "explorer-agent · finished"). The extension keeps the open agent's buffer (do not drop it in `retain`) and stops refreshing it once the agent is gone. Closing the panel releases it.

**Commit:** `feat(office): keep a finished agent's activity in the open side panel`

---

### Task 4: "Show all projects" option

**Files:** `package.json` (setting + two commands + view-title toggle icons), `src/sessionTreeDataProvider.ts`, `src/extension.ts`.

**Requirements:** new setting `agentville.showAllProjects` (boolean, default `false`, `window` scope, English description). When true, the tree and the office show Claude Code sessions from every project (the workspace-folder filter is skipped; the last-hour rule stays). Two commands, "AgentVille: Show All Projects" and "AgentVille: Show This Project Only", flip the setting and appear as a toggle icon in the view title next to the existing ones (same pattern as the enable/disable eye). Changing the setting refreshes the tree and the office. Unit-test the filter decision in the pure assembly code if it lives there (`src/sessionAssembly.ts`), otherwise keep the change in the provider minimal.

**Commit:** `feat: option to show agents from all projects`

---

### Task 5: Draw background agents in the office

**Files:** `src/sessionTreeDataProvider.ts` (`getSessions`), `src/types.ts` (only if a transcript path must travel with a nested agent), `src/sessionAssembly.ts` (only if `sessionAsSubagent` must carry it), `src/officePanel.ts`, tests.

**Requirements:** background agents that the tree nests under the session that launched them (the provider's nested-agent map) appear in the office as subagents of that session, with their action read from their own transcript (they are top-level `.jsonl` files, not under `subagents/`). Do not mutate the provider's cached sessions when merging. Same "working only" read rule as other subagents.

**Commit:** `feat(office): draw background agents nested under their launcher`

---

### Task 6: Resumed subagent reads stopped after a reload

**Files:** `src/logParser.ts` and/or `src/subagentDetector.ts` / `src/subagentMetadata.ts`, tests (prefer a small redacted real-log fixture under `src/test/fixtures/real-logs/`, following that folder's conventions).

**Bug:** on a cold full parse (window reload), a subagent resumed with `SendMessage` keeps reading `stopped`: `detectSendMessageResume` matches the message's `to` against the subagent's name or `agentId`, but `agentId` is only filled from the sidecar after the line loop, so the resume is missed. Incremental parses usually hold `agentId` already.

**Requirements:** resolve resume targets that could not be matched during the line loop after sidecar enrichment (or an equivalent ordering fix), so a cold parse and an incremental parse agree. Regression test proving a cold parse marks the resumed subagent `working`. Keep every existing detector behaviour and comment.

**Commit:** `fix: a SendMessage-resumed subagent stays working after a cold parse`

---

### Task 7: Docs

**Files:** `README.md`, `resources/ASSETS.md` only if seats change how art is used.

**Requirements:** describe situated behaviour in Features (move "Situated behaviour" out of the Roadmap; keep Progression there), the 30 fps cap, the entrance sign, the "show all projects" toggle, background agents in the office, and the kept feed. Remove limits that no longer apply. Keep every other section.

**Commit:** `docs: situated behaviour, all-projects toggle and office polish`

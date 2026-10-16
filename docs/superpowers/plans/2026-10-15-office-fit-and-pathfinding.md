# AgentVille — Office: Fill the Tab and Walk Around Furniture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Two follow-ups to the office (sub-project 1), requested by the fork's owner on 2026-10-15: (1) characters walk around furniture and walls instead of straight through them; (2) the office fills the editor tab instead of rendering at the largest integer zoom.

**Spec:** `docs/superpowers/specs/2026-08-13-agentville-office-design.md`. Deliberate deviation, requested by the user: §7 says "rendered at integer scale"; Task 2 replaces that with a fractional fit. Everything else in §7 still holds (no camera pan, no scroll, the whole office always on screen). Pathfinding does not pull in sub-project 2: targets stay random; only the route changes.

## Global Constraints

- The repo's lint gate (complexity 10, max-statements 20, max-lines-per-function 100, max-params 3, max-lines 355, typescript-eslint strictTypeChecked, prettier) and boundary rules apply: `src/webview/simulation/**` stays pure (no Phaser, no DOM); the renderer reads simulation output and never mutates it.
- Run `npx tsc --noEmit`, `npm run lint`, `npm run test` (and `npm run build`) before considering a task done. `npm run test:coverage` thresholds (80/65/80/80) must keep passing.
- Existing simulation tests keep passing unchanged unless a test pins behaviour this plan intentionally replaces; say so explicitly if one must change.
- User-facing strings and docs are English.

---

### Task 1: Walk around furniture (grid pathfinding)

**Files:**
- Create: `src/webview/simulation/pathfinding.ts` — pure grid search over `OFFICE_MAP` walkability.
- Modify: `src/webview/simulation/population.ts` — `Character` gains `path: { x: number; y: number }[]` (remaining waypoints, world-pixel tile centres; empty when not routing). Spawned characters start with an empty path. A character marked `leaving` gets a path to `DOOR`; a returning `leaving` character (the stop-where-it-stands rule) clears its path.
- Modify: `src/webview/simulation/movement.ts` — `step` moves toward `path[0]` when the path is non-empty and drops a waypoint once reached (carrying any leftover travel within the same step is optional); with an empty path it keeps today's behaviour (straight toward `targetX/targetY`), so existing tests hold. `pickTarget` chooses a random tile among those REACHABLE from the character's current tile and sets both the target and the path; when nothing is reachable it returns `state: 'idle'` as today. Keep `random` injected and the choice deterministic for a given random source.
- Modify: `src/webview/render/officeScene.ts` — the walk direction comes from the next waypoint (`path[0]`, else the target); arrival logic keeps working (the final waypoint equals the target).
- Test: `src/test/officeSimulation.test.ts` (or a new `src/test/officePathfinding.test.ts` if the file would pass ~300 lines).

**Rules:**
- 4-neighbour moves only (matches the 4-direction sprites; no diagonal corner-cutting). Uniform cost, so breadth-first search is enough; the map is 40x24.
- Start tile = the tile under the character's feet (`floor(x / 16)`, `floor(y / 16)`). If the character is not exactly at that tile's centre, the first waypoint is that centre, so it never cuts a corner diagonally. If the start tile is not walkable (should not happen), fall back to today's straight line with an empty path.
- Never allocate the search per frame: search only when a new target is picked or a character starts leaving.

**Acceptance tests (must exist and pass):**
- Every walkable tile is reachable from the door tile (map connectivity invariant — it guards future map edits).
- A computed path: ends at the target centre; every waypoint is on a walkable tile; consecutive waypoints are 4-adjacent (exactly one tile apart on one axis).
- `pickTarget` from the door produces a reachable target and a valid path; same random source gives the same result.
- Stepping a character along its path until arrival never samples a position on a non-walkable tile (check after each small step).
- `reconcile` marking a character as leaving gives it a valid path to the door; a returning leaving character has an empty path.

**README:** drop "no pathfinding yet, so characters may walk across furniture" from the limits; say characters walk around furniture.

**Commit:** `feat(office): characters walk around furniture`

---

### Task 2: Fill the editor tab

**Files:**
- Modify: `src/webview/render/officeScene.ts` — replace the integer `getMaxZoom()` fit with a fractional fit: `zoom = max(MIN_ZOOM, min(parentWidth / WORLD_WIDTH, parentHeight / WORLD_HEIGHT))` with `MIN_ZOOM = 0.5`, still centred, recomputed on resize; initial game config must not depend on `MAX_ZOOM`. Keep `pixelArt: true`. Update comments that promise integer zoom.
- Modify (only if needed): `src/webview/ui/nameTags.ts` / `bubbles.ts` comments that say "integer zoom"; offsets already scale with `zoom`.
- Modify: `README.md` if it mentions the integer zoom.

**Acceptance:**
- At a 1280x720 viewport the office's canvas is about 1200 px wide (fills the width or the height, whichever binds) and centred; name tags and bubbles stay attached to their characters.
- At a small viewport (e.g. 400x300) it shrinks below 1x instead of overflowing.
- No console errors; overlays aligned (headless-browser smoke screenshots at both sizes).

**Commit:** `feat(office): scale the office to fill the editor tab`

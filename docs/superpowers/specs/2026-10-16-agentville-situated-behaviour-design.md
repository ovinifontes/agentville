# AgentVille — Situated Behaviour (sub-project 2)

**Status:** approved by the fork's owner on 2026-10-16, implemented by `docs/superpowers/plans/2026-10-16-office-situated-and-polish.md`
**Builds on:** `2026-08-13-agentville-office-design.md` (sub-project 1) and the 2026-10-15 pathfinding follow-up.

## Goal

Characters walk to the furniture that matches what their agent is doing, instead of wandering at random. The office then reads at a glance: people at the shelves are reading, people at the desks are editing or running things, people at the meeting table are delegating, people at the coffee corner are idle.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| S1 | **Activity → place.** `Reading …`, `Searching …`, `Researching` → shelves. `Editing …`, `Running …`, `Planning`, `Thinking`, `Working` → desks. `Delegating …` → meeting table. A stopped agent (no action) → lounge (coffee counter and sofa). | Matches the original roadmap (shelf when reading, desk when editing, coffee when idle). There is no CC0 printer sprite, so commands run "at the computer" (desk). |
| S2 | **Spots are derived from the map, once.** Desk spots are the chair tiles (`C`) next to desks; meeting spots are the meeting chairs and the tiles inside the meeting table; shelf spots are the walkable tiles directly in front of each shelf tile (`R`); lounge spots are the tiles in front of the coffee counter (`K`) and the sofa tiles (`S`). Each spot records the direction the character faces while there (toward the furniture; down when sitting on the sofa). | No hand-maintained coordinate list to drift from the ASCII map. |
| S3 | **Chairs and the sofa become walkable seats.** A character standing on a seat tile, facing the desk, reads as sitting at it. Desks, tables, shelves, counters, plants and walls stay solid. | Simplest way to "sit" with 4-direction sprites; no new art. |
| S4 | **One character per spot.** A character claims a free spot of the kind its activity needs. The first spot tried is chosen by a stable hash of the agent id, so the same agent tends to return to the same desk. If every spot of that kind is taken, the character wanders as before. | Prevents stacking; keeps identity stable. |
| S5 | **Re-target only when the place changes.** While its activity keeps mapping to the same kind of place, a character stays at its spot (no wandering). When the kind changes (e.g. `Reading` → `Editing`), it walks to a new spot immediately along a grid path. Leaving (agent gone) still overrides everything. | No per-frame searching; motion carries meaning. |
| S6 | **Simulation stays pure and tested.** Spot derivation, activity classification, claiming and target choice live in `src/webview/simulation/`; the renderer only asks "where to now?" on arrival or on a kind change, and faces the spot's direction while standing there. | Same boundary as sub-project 1. |

## Out of scope

Progression (XP, levels, day/night) is sub-project 3. New art is out of scope; furniture keeps the CC0 sprites.

## Acceptance

1. A working agent whose action is `Reading x.ts` ends up standing in front of a shelf, facing it; `Editing x.ts` ends up on a desk chair facing the desk; `Delegating to …` at the meeting table; a stopped agent in the lounge.
2. Two characters never claim the same spot; when a kind is full, extras wander.
3. Changing action kind sends the character to a new spot without passing through furniture.
4. Leaving still walks out by the door; a returning agent re-claims a spot.
5. All existing tests pass; new pure-module tests cover classification, spot derivation (every spot reachable from the door; facing points at the furniture), claiming and re-targeting.

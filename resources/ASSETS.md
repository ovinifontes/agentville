# Office assets

## Baseline (shipped)

| Asset                   | Source                                                                                                                                                                                                                | Licence |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `office/tiles.png`      | Kenney _Roguelike/RPG pack_ (https://kenney.nl/assets/roguelike-rpg-pack), Kenney _Roguelike Indoors_ (https://kenney.nl/assets/roguelike-indoors), Kenney _RPG Urban Pack_ (https://kenney.nl/assets/rpg-urban-pack) | CC0 1.0 |
| `office/characters.png` | Kenney _RPG Urban Pack_ (https://kenney.nl/assets/rpg-urban-pack)                                                                                                                                                     | CC0 1.0 |

Full licence text: `resources/office/LICENSE-ASSETS.txt`

## Sprite sheet layout

- `tiles.png` — 16×16 tiles, 11 columns (a single row, no margin or spacing: 176×16). Frame index → map
  legend: 0 floor `.`, 1 wall `#`, 2 rug `,`, 3 desk `D`, 4 chair `C`, 5 meeting table `T`, 6 plant `P`,
  7 sofa `S`, 8 coffee counter `K`, 9 shelf/printer `R`, 10 door `_`. Floor and wall are opaque. The renderer
  draws the floor under every tile, so tiles 2–10 are transparent wherever the floor should show through.
  Each furniture tile is one segment that repeats side by side (`DDDD` is one desk, four tiles wide).
- `characters.png` — 16×24 frames, 4 directions × 4 walk frames per character set,
  character sets stacked vertically
  - 4 columns × 32 rows, 64×768: 8 sets × 4 direction rows × 24 px.
  - Direction rows within a set, in order: down, left, right, up. Each row holds 4 walk frames.
  - Frame index = ((set × 4) + direction) × 4 + frame.
  - Sets 0–3 are sessions (people in casual clothes). Sets 4–7 are subagents (a hard-hat crew;
    sets 5–7 are palette swaps of set 4).
  - Characters are 16×16 at source and sit bottom-aligned in the 16×24 frame, with transparent padding on
    top.

## Premium override (local only, NOT in this repository)

The webview loads its art from `dist/office/`, which the build fills: `esbuild.js` copies
`resources/office/` there, then — on dev (non-minified) builds only — copies a licensed
commercial pack from `resources/office-premium/` over it, when that directory exists and uses
the same filenames and layout as above. The minified build that `vscode:prepublish` runs for
every `.vsix` never applies the overlay, so releases always ship the CC0 baseline. Tracked
files under `resources/office/` are never overwritten. The premium directory is gitignored and
listed in `.vscodeignore`.

**Status: not cleared for release.** The candidate pack (LimeZu _Modern Interiors_)
permits "edit and use the asset in any commercial or non commercial project" and forbids
"resell or distribute the asset to others". A `.vsix` is a plain ZIP with extractable
PNGs, which sits between those two clauses.

Before any release ships a commercial pack:

1. Obtain written confirmation from the pack's author that bundling in a freely
   distributed VS Code extension is permitted.
2. Record that confirmation — date, channel, exact wording — in this file.
3. Add the required credit and link to `NOTICE` and `README.md`.

Until all three are done, releases ship the CC0 baseline — and even then, shipping it would
first need the minified-build guard in `esbuild.js` lifted deliberately.

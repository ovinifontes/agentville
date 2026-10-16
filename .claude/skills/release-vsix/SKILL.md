---
name: release-vsix
description: Package this VS Code extension into an installable .vsix. Use when asked to "gerar nova versão da extensão", "nova release", "release the extension", "package/build the vsix", "empacotar a extensão", or "ship it". Runs `npm run package` (patch bump + minified esbuild build + vsce package), guards bundle size, and reports the artifact.
---

# release-vsix

Package the extension for distribution as a `.vsix`.

> **Publishing to the store is not this skill.** A real release goes through
> `gh workflow run release.yml -f bump=patch` (verify → bump → package → Open VSX →
> push → GitHub Release) — see `docs/PUBLISHING.md`. Use this skill for local builds
> and testing only.

## Steps

1. **Clean tree** — `git status`. The package script bumps the patch version in
   `package.json`, so commit or stash unrelated changes first, or they get mixed in.
2. **Verify** before shipping:
   ```bash
   npm run lint && npx tsc --noEmit && npm run test
   ```
3. **Check `.vscodeignore` excludes everything that must not ship.** The bundle holds
   `dist/extension.js`, `dist/webview.js` (the office webview with Phaser, ~1.2 MB
   minified), `dist/office/*` (the CC0 office art and its licence), `resources/icon.png`,
   `resources/office/*`, `resources/ASSETS.md`, `package.json`, `readme.md`, `LICENSE.txt`
   and `NOTICE` — nothing else. Any dev/harness directory added since the last release
   (e.g. `.claude/`, `.superpowers/`, `vault-obsidian/`, `graphify-out/`, `.github/`,
   `docs/`, `scripts/`, and root files like `CLAUDE.md`, `.mcp.json`, `.lsp.json`)
   **must** be listed in `.vscodeignore`, or vsce packs it. `resources/office-premium/`
   (commercial art, a local dev override only) must never appear.
   ⚠️ `.claude/scripts/node_modules/` alone carries a ~243 MB SDK binary — a stale
   `.vscodeignore` produced a 77 MB / 3000-file bundle once.
4. **Package:**
   ```bash
   npm run package
   ```
   Removes any old `*.vsix`, bumps the patch version (`npm version patch --no-git-tag-version`),
   builds the minified bundle (`vscode:prepublish` → `node esbuild.js --minify`), and
   produces `agentville-<version>.vsix` at the repo root.
5. **Guard the size** — read the vsce summary. A healthy bundle is about 16 files and
   roughly 0.5 MB (vsce's "webview.js is large" warning is expected: that is Phaser). If it
   reports more than 2 MB, dozens of files, or any file outside the list in step 3, something
   leaked: add it to `.vscodeignore`, `git checkout -- package.json package-lock.json` to undo
   the bump, and re-run step 4 (so the version only advances once).
6. **Report** the generated `.vsix` filename, its size/file-count, and the new version.
7. **Remind to install + reload:**

   ```bash
   code --install-extension agentville-<version>.vsix --force
   # or Antigravity: antigravity-ide --install-extension <file> --force
   ```

   Then Command Palette → _Developer: Reload Window_.

## Notes

- The version bump is **not** committed automatically — review and commit `package.json`
  (and `package-lock.json`) after packaging. The `.vsix` itself is gitignored.
- For a clean upgrade instead of `--force`, the bumped version alone is enough.

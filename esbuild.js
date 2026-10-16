const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const isWatch = args.includes("--watch");
const isMinify = args.includes("--minify");

const extensionOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  minify: isMinify,
  sourcemap: !isMinify,
  logLevel: "info",
};

// The office webview runs in a browser context inside VS Code, not in Node. Phaser is
// bundled in here — it must never reach the extension bundle.
const webviewOptions = {
  entryPoints: ["src/webview/main.ts"],
  bundle: true,
  outfile: "dist/webview.js",
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: isMinify,
  sourcemap: !isMinify,
  logLevel: "info",
};

// The office webview loads its art from dist/office/, never from resources/: the build
// copies the committed CC0 baseline there and, on dev (non-minified) builds only, overlays
// the premium tileset when it exists locally. The premium pack is licensed per developer and
// not cleared for redistribution (resources/ASSETS.md), so the minified build that
// `vscode:prepublish` runs for every .vsix never copies it. dist/office/ is emptied first so
// a premium file left by an earlier dev build cannot reach a release. Tracked files are never
// written; filenames are identical, so nothing downstream branches on which tier is active.
function copyOfficeAssets() {
  const target = path.join(__dirname, "dist", "office");
  const premium = path.join(__dirname, "resources", "office-premium");
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(path.join(__dirname, "resources", "office"), target, { recursive: true });
  if (isMinify || !fs.existsSync(premium)) {
    return;
  }
  fs.cpSync(premium, target, { recursive: true });
  console.log("Applied premium office assets over the baseline (dev build only).");
}

async function run() {
  copyOfficeAssets();
  if (isWatch) {
    for (const options of [extensionOptions, webviewOptions]) {
      const ctx = await esbuild.context(options);
      await ctx.watch();
    }
    console.log("Watching for changes...");
  } else {
    await Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)]);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

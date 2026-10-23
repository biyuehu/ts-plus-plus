/**
 * Builds the browser ESM bundle from the ts-plus-plus package's public source entry.
 *
 * The main repo's own lib bundle (built/local/typescript.js) is CJS for Node; the worker
 * needs an ES module, so we bundle the public API surface (src/typescript/typescript.ts)
 * with esbuild directly.
 */
import { createRequire } from "node:module";
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const entry = require.resolve("ts-plus-plus/source");
const compilerDeclaration = require.resolve("ts-plus-plus").replace(/\.js$/, ".d.ts");
// --dev: write typescript.dev.js into public/ (git-ignored) for the ?ts=dev
// local-compiler workflow; default: the deployed public/vendor/typescript.js
// (public/ so `vite build` copies it verbatim into dist/)
const dev = process.argv.includes("--dev");
const outDir = join(root, "public", dev ? "" : "vendor");
const outfile = join(outDir, dev ? "typescript.dev.js" : "typescript.js");

if (!existsSync(entry)) {
  console.error(`Compiler package entry not found at ${entry}`);
  process.exit(1);
}

const esbuild = require("esbuild");

mkdirSync(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2020",
  sourcemap: false,
  sourcesContent: false,
  legalComments: "none",
  // Node builtins appear only inside lazily-called `require(...)` paths (getNodeSystem in
  // sys.ts, macro module evaluation, the Node macro/verification workers). In the browser
  // worker `typeof process === "undefined"` so `isNodeLikeSystem()` is false and none of
  // these paths execute; esbuild's __require shim throws only if one ever is invoked.
  // Both prefixed and unprefixed specifiers are used in the sources, so list both forms.
  external: [
    "module", "node:module", "os", "node:os", "fs", "node:fs", "path", "node:path",
    "url", "node:url", "crypto", "node:crypto", "inspector", "node:inspector",
    "child_process", "node:child_process", "worker_threads", "node:worker_threads",
    "events", "node:events", "util", "node:util", "buffer", "node:buffer", "z3-solver",
  ],
  logLevel: "info",
});

copyFileSync(compilerDeclaration, join(outDir, dev ? "typescript.dev.d.ts" : "typescript.d.ts"));

const kb = Math.round(statSync(outfile).size / 1024);
console.log(`Bundled ${kb} KB -> ${dev ? "public/typescript.dev.js (serve with `npm run dev`, open ?ts=dev)" : "public/vendor/typescript.js"}`);

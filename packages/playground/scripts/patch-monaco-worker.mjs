/**
 * Replaces monaco-editor's stock TypeScript worker entry with the tspp worker.
 *
 * Why: monaco 0.57's TypeScript mode spawns its worker with a direct
 * `new Worker(new URL("ts.worker.js", import.meta.url))` inside workerManager.js —
 * it does not consult MonacoEnvironment.getWorker, customWorkerPath (which is only
 * forwarded as createData), or build-time aliases for the URL literal. The only
 * reliable interception point is the file itself.
 *
 * The replacement (src/worker/tspp.worker.js) keeps the exact same protocol:
 * editor.worker.initialize((ctx, createData) => new TypeScriptWorker(...)), but the
 * language service inside is the tspp compiler bundle. Re-run after every
 * `pnpm install` (wired as the postinstall script) and after upgrading monaco.
 */
import { copyFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const target = require.resolve("monaco-editor/languages/features/typescript/ts.worker.js");

const sourceText = readFileSync(join(root, "src", "worker", "tspp.worker.js"), "utf8");
const before = readFileSync(target, "utf8");
if (before === sourceText) {
  console.log("patch-monaco-worker: already patched");
  process.exit(0);
}
copyFileSync(join(root, "src", "worker", "tspp.worker.js"), target);
console.log("patch-monaco-worker: stock ts.worker.js replaced with the tspp worker");

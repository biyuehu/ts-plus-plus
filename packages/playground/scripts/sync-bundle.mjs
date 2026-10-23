/**
 * Copies the ts-plus-plus compiler lib bundle from packages/compiler into
 * public/vendor/, so the app and worker can load it at runtime.
 *
 * Run after building the compiler package.
 */
import { copyFileSync, mkdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const compilerRoot = process.env.TSPP_REPO ?? join(root, "..", "compiler");
const source = join(compilerRoot, "built", "local", "typescript.js");
const targetDir = join(root, "public", "vendor");
const target = join(targetDir, "typescript.js");

if (!existsSync(source)) {
  console.error(`Compiler bundle not found at ${source}`);
  console.error("Build the main repo first.");
  process.exit(1);
}
mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
const kb = Math.round(statSync(target).size / 1024);
const version = JSON.parse(readFileSync(join(compilerRoot, "package.json"), "utf8")).version;
console.log(`Copied typescript.js (${kb} KB, ts-plus-plus v${version}) -> public/vendor/typescript.js`);

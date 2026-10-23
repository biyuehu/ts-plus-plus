/**
 * Copies the ts-plus-plus compiler lib bundle from the monorepo root into
 * public/vendor/, so the app and worker can load it at runtime.
 *
 * Run after building the main repo (stock tsc -b src/typescript --emitDeclarationOnly false).
 * In CI this script runs after building the compiler package at the repository root.
 */
import { copyFileSync, mkdirSync, existsSync, statSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const mainRepo = process.env.TSPP_REPO ?? join(root, "..", "..");
const source = join(mainRepo, "built", "local", "typescript.js");
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
const version = JSON.parse(readFileSync(join(mainRepo, "package.json"), "utf8")).version;
console.log(`Copied typescript.js (${kb} KB, ts-plus-plus v${version}) -> public/vendor/typescript.js`);

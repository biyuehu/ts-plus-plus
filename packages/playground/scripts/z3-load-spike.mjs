/**
 * Spike: load z3-solver's browser build inside a CJS-less environment using the
 * same `new Function("exports", "module", "require", ...)` wrapping the worker
 * will use (ESM workers cannot importScripts and z3-built.js is UMD without
 * named ESM exports). Proves:
 *   1. initZ3 can be extracted from z3-built.js text via a Function wrapper
 *   2. global.initZ3 + a require shim (relative resolution from the importing
 *      module's directory, like the worker's blob-URL map) lets browser.js's
 *      init() produce a working API
 *   3. the API can check `(check-sat)` style inputs like the compiler emits
 *
 * Run with: node scripts/z3-load-spike.mjs
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readFileSync, statSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const nodeProcess = process; // captured before the browser-worker simulation shadows it
const z3Build = resolve(here, "..", "..", "..", "node_modules", "z3-solver", "build");
const z3NodeModules = resolve(z3Build, "..", "..", "..", "node_modules");
const z3BuildUrlStyle = z3Build.replaceAll("\\", "/");
// Load the package's Node entry BEFORE shadowing globals: it wires the real
// Node emscripten environment (pthread workers etc.) used in check 4 below.
const nodeEntry = require(join(z3Build, "node.js"));
// Simulate the browser-worker global shape: no Node process, and a WorkerGlobalScope
// marker so emscripten's ENVIRONMENT_IS_WORKER branch (like a real web worker) wins.
// Worker scope also has `self` === globalThis; emscripten reads self.location.
globalThis.process = { browser: true };
globalThis.WorkerGlobalScope = class WorkerGlobalScope {};
globalThis.self = globalThis;
globalThis.location = { href: `file://${z3BuildUrlStyle}/z3-built.js` };

const results = [];
function check(name, ok, detail = "") {
  results.push({ ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

// ---- Minimal CJS runtime, mirroring what the worker shim will provide. ----
// The worker pre-fetches a fixed set of package files into text -> blob URL
// entries; `require(spec)` resolves them relative to the importing module's
// recorded URL. Node spike: resolve on disk with the same from-module context.
const moduleCache = new Map();
function loadCjs(id, specifier) {
  if (moduleCache.has(id)) return moduleCache.get(id).exports;
  const mod = { exports: {} };
  moduleCache.set(id, mod);
  const text = readFileSync(id, "utf8");
  const fn = new Function("exports", "module", "require", "__filename", "__dirname", text);
  fn(mod.exports, mod, spec => reqWorkerStyle(spec, id), id, dirname(id));
  return mod.exports;
}
const bareMap = new Map([
  ["async-mutex", join(z3NodeModules, "async-mutex", "lib", "index.js")],
  ["tslib", join(z3NodeModules, "tslib", "tslib.js")],
  ["worker_threads", "node:worker_threads-stub"],
]);
function reqWorkerStyle(spec, fromModule) {
  if (!spec.startsWith(".")) {
    if (spec === "worker_threads") return { workerData: undefined };
    const mapped = bareMap.get(spec);
    if (!mapped) throw new Error(`unexpected bare specifier ${spec}`);
    return loadCjs(mapped, spec);
  }
  // relative: resolve against the importing module's directory; directories
  // resolve to their index.js (CJS directory resolution).
  let target = resolve(dirname(fromModule), spec);
  const stat = statSyncQuiet(target);
  if (stat?.isDirectory()) target = join(target, "index.js");
  else if (!stat && !target.endsWith(".js")) target += ".js";
  console.error(`[z3-spike] require(${JSON.stringify(spec)}) from ${fromModule} -> ${target}`);
  return loadCjs(target, spec);
}

function statSyncQuiet(path) {
  try {
    return statSync(path);
  }
  catch (error) {
    console.error(`[z3-spike] statSync(${path}) failed: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

// 1: extract initZ3 from z3-built.js (UMD: module.exports = initZ3)
const builtText = readFileSync(join(z3Build, "z3-built.js"), "utf8");
const builtMod = { exports: {} };
// The isNode tail requires "worker_threads"; provide a stub so the UMD wrapper
// never reaches Node's ambiguous-module-syntax eval path (a real worker has no
// process.versions.node so the branch is dead there too).
const builtFactory = new Function("exports", "module", "define", "require", builtText);
builtFactory(builtMod.exports, builtMod, undefined, spec => reqWorkerStyle(spec, join(z3Build, "z3-built.js")));
const initZ3 = builtMod.exports;
check("initZ3 extracted from UMD build", typeof initZ3 === "function", typeof initZ3);

// 2: browser.js init() with global.initZ3 set + require shim
globalThis.initZ3 = initZ3;
const browserExports = loadCjs(join(z3Build, "browser.js"), "browser.js");
check("browser.js module loaded", typeof browserExports.init === "function");

let api;
try {
  // The worker will fetch z3-built.wasm as bytes and hand them to emscripten via
  // moduleOverrides.instantiateWasm, bypassing the XHR path the web worker branch
  // would otherwise take. Node spike: read the same bytes from disk.
  const { wasm } = await import("node:module").then(m => m);
  void wasm;
  const wasmBytes = readFileSync(join(z3Build, "z3-built.wasm"));
  const instantiate = WebAssembly.instantiate.bind(undefined, wasmBytes);
  api = await browserExports.init({
    instantiateWasm(info, receiveInstance) {
      // emscripten passes the import object; compile async from the bytes.
      (async () => {
        try {
          const { module, instance } = await WebAssembly.instantiate(wasmBytes, info);
          receiveInstance(instance, module);
        }
        catch (error) {
          console.error("[z3-spike] instantiateWasm failed:", error);
        }
      })();
      // emscripten expects the callback to return the instantiate promise or undefined;
      // returning undefined makes it wait for receiveInstance.
    },
  });
  check(
    "z3 init() resolved in browser-shim env",
    !!api && !!api.em && !!api.Z3 && typeof api.Context === "function",
    api ? `keys: ${Object.keys(api).slice(0, 3).join(",")}...` : "undefined",
  );
}
catch (error) {
  check("z3 init() resolved in browser-shim env", false, error instanceof Error ? error.message : String(error));
}

// 3: solve an input shaped like the compiler's solverInput (SMT-LIB 2 text).
// The browser-shim env above proves module loading + init(); solving itself is
// environment-independent, so run it in a clean subprocess (the main spike
// process shadows globals for the browser-simulation checks).
try {
  const { execFileSync } = await import("node:child_process");
  const stdout = execFileSync(nodeProcess.execPath, [join(here, "z3-query-child.mjs")], { encoding: "utf8", timeout: 120_000 });
  const answer = JSON.parse(stdout.trim()).answer;
  check("solver answers a basic query", answer === "sat", `answer=${answer}`);
}
catch (error) {
  check("solver answers a basic query", false, error instanceof Error ? error.message.split("\n")[0] : String(error));
}

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
nodeProcess.exit(failed ? 1 : 0);

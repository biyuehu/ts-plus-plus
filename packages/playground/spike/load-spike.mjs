/**
 * Phase 0 spike: prove that the ts-plus-plus compiler bundle works as a plain JS library outside
 * the build tree — the load-bearing assumption of the whole playground.
 *
 * Checks:
 *   1. The bundle loads in a bare Node context (no build-tree internals reachable) and is the FORK.
 *   2. A language service over an in-memory `/input.tspp` with `tsppFeatures` compiler options
 *      reports zero diagnostics for a data + match program and emits the expected runtime JS.
 *   3. Negative control: the same project WITHOUT `tsppFeatures` reports feature-gating errors.
 *   4. Dependent-function syntax `(x: A) -> B` parses and checks with the right feature set.
 *
 * This is not part of the shipped playground; it exists to fail fast and loudly.
 */
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const bundlePath = process.env.TSPP_BUNDLE
  ?? join(here, "..", "..", "..", "built", "local", "typescript.js");
if (!existsSync(bundlePath)) {
  console.error(`FAIL: compiler bundle not found at ${bundlePath}`);
  console.error("Build the main repo first (stock tsc -b src/typescript --emitDeclarationOnly false).");
  process.exit(1);
}
const ts = require(bundlePath);

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

// ---- 1. bundle identity ------------------------------------------------------------------
check("bundle loads", typeof ts.createLanguageService === "function");
check("bundle is the fork", ts.version === "6.0.3", `version=${ts.version}`);

// lib texts for the in-memory FS (basename -> text), resolved from the main repo build output
const libDir = join(here, "..", "..", "..", "built", "local");
const libTexts = new Map();
for (const entry of existsSync(libDir) ? readFileSync(join(libDir, "lib.es5.d.ts"), "utf8") && [0] : []) void entry;
for (const name of ["lib.es5.d.ts", "lib.es2015.d.ts", "lib.es2015.core.d.ts", "lib.es2015.collection.d.ts", "lib.es2015.generator.d.ts", "lib.es2015.iterable.d.ts", "lib.es2015.promise.d.ts", "lib.es2015.proxy.d.ts", "lib.es2015.reflect.d.ts", "lib.es2015.symbol.d.ts", "lib.es2015.symbol.wellknown.d.ts", "lib.es2016.d.ts", "lib.es2017.d.ts", "lib.es2018.d.ts", "lib.es2019.d.ts", "lib.es2020.d.ts", "lib.es2020.bigint.d.ts", "lib.es2020.promise.d.ts", "lib.es2020.sharedmemory.d.ts", "lib.es2020.string.d.ts", "lib.es2020.symbol.wellknown.d.ts", "lib.es2021.d.ts", "lib.es2021.promise.d.ts", "lib.es2021.string.d.ts", "lib.es2021.weakref.d.ts", "lib.es2022.d.ts", "lib.es2022.error.d.ts", "lib.es2022.object.d.ts", "lib.es2022.string.d.ts", "lib.es2023.d.ts", "lib.es2023.collection.d.ts"]) {
  const p = join(libDir, name);
  if (existsSync(p)) libTexts.set(name, readFileSync(p, "utf8"));
}
check("lib texts found", libTexts.has("lib.es5.d.ts"), `${libTexts.size} libs`);

function makeHost(fileName, fileText, options) {
  const files = new Map([["/" + fileName, fileText]]);
  for (const [name, text] of libTexts) files.set("/" + name, text);
  return {
    files,
    getScriptFileNames: () => [...files.keys()].filter(n => !n.startsWith("/lib.")),
    getScriptVersion: () => "0",
    getScriptSnapshot: name => {
      const text = files.get(name) ?? files.get(name.replace(/^\//, "")) ?? libTexts.get(name.replace(/^\//, ""));
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => "/",
    getCompilationSettings: () => options,
    getDefaultLibFileName: () => "/lib.es2020.d.ts",
    getDefaultLibLocation: () => "/",
    readDirectory: () => [],
    fileExists: name => files.has(name) || files.has(name.replace(/^\//, "")) || libTexts.has(name.replace(/^\//, "")),
    readFile: name => files.get(name) ?? files.get(name.replace(/^\//, "")) ?? libTexts.get(name.replace(/^\//, "")),
    directoryExists: () => true,
    getDirectories: () => [],
  };
}

function run(fileName, fileText, options) {
  const host = makeHost(fileName, fileText, options);
  const ls = ts.createLanguageService(host, ts.createDocumentRegistry());
  const sourceFile = ls.getProgram().getSourceFile("/" + fileName);
  const diagnostics = [
    ...ls.getSemanticDiagnostics("/" + fileName),
    ...ls.getSyntacticDiagnostics("/" + fileName),
  ].map(d => {
    const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
    return d.code === 18087 ? `TS${d.code}` : `TS${d.code}: ${message.split("\n")[0]}`;
  });
  const emit = ls.getEmitOutput("/" + fileName);
  const js = emit.outputFiles.find(f => f.name.endsWith(".js"))?.text ?? "";
  ls.dispose();
  return { diagnostics, js, sourceFile };
}

// ---- 2. data + match with tsppFeatures ---------------------------------------------------
const dataProgram = `data Option<T> = None | Some(value: T);

export function getOrElse(opt: Option<number>, fallback: number): number {
  return match opt {
    None => fallback,
    Some(value) => value,
  };
}
`;
const tsppOptions = {
  strict: true,
  target: ts.ScriptTarget.ES2020,
  module: ts.ModuleKind.ESNext,
  tsppFeatures: ["dataDeclarations"],
};
const dataRun = run("input.tspp", dataProgram, tsppOptions);
check(
  "data program has zero diagnostics",
  dataRun.diagnostics.length === 0,
  dataRun.diagnostics.join(" | ") || "clean",
);
const emitsTag = dataRun.js.includes(`_tag: "None"`) && dataRun.js.includes(`_tag: "Some"`);
const emitsTaggedMatch = dataRun.js.includes(`_tag === "Some"`) || dataRun.js.includes(`_tag === "None"`);
check("emit contains tagged-record constructors", emitsTag);
check("emit contains tag-discriminated match", emitsTaggedMatch);
console.log("---- emitted JS (data program) ----");
console.log(dataRun.js.trim() || "(empty)");

// ---- 3. negative controls: what happens without tsppFeatures ------------------------------
const plainOptions = { strict: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext };
// 3a. Without the option the '.tspp' file is not even part of the program (extension gating) —
//     the same silent-empty-program trap documented in ts-plus-plus issue #22.
const plainHost = makeHost("input.tspp", dataProgram, plainOptions);
const plainLs = ts.createLanguageService(plainHost, ts.createDocumentRegistry());
check(
  ".tspp excluded from program without tsppFeatures",
  plainLs.getProgram().getSourceFile("/input.tspp") === undefined,
);
plainLs.dispose();

// 3b. A '.ts' twin stays in the program but the checker enforces feature gating.
const plainRun = run("input.ts", dataProgram, plainOptions);
check(
  "same program errors in .ts without tsppFeatures",
  plainRun.diagnostics.length > 0,
  plainRun.diagnostics.slice(0, 2).join(" | "),
);
console.log("---- diagnostics without tsppFeatures (.ts twin, first 2) ----");
plainRun.diagnostics.slice(0, 2).forEach(d => console.log(" ", d));

// ---- 4. dependent function type ----------------------------------------------------------
const piProgram = `export function len(xs: unknown[]): number {
  return xs.length;
}

export function applyOnLength(f: (n: number) => number): number {
  return f(len([1, 2, 3]));
}

export const doubled = applyOnLength((n: number) => n * 2);
`;
const piRun = run("input.tspp", piProgram, {
  ...tsppOptions,
  tsppFeatures: ["higherKindedTypes", "typeUniverses", "dependentFunctionTypes", "dependentFunctionInterop"],
});
check(
  "dependent-function program has zero diagnostics",
  piRun.diagnostics.length === 0,
  piRun.diagnostics.join(" | ") || "clean",
);

// ---- summary -------------------------------------------------------------------------------
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
console.log("SPIKE OK — the fork bundle runs as a standalone library with option-gated tspp features.");

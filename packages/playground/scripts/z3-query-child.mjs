// Clean-environment subprocess: load z3-solver's Node entry and answer one
// SMT-LIB query shaped like the compiler's solverInput. Run by z3-load-spike.mjs.
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const z3Build = resolve(here, "..", "..", "..", "node_modules", "z3-solver", "build");
const entry = require(join(z3Build, "node.js"));
const api = await entry.init();
const context = new api.Context("spike");
const solver = new context.Solver();
solver.fromString("(declare-const x Int)\n(assert (> x 3))\n(check-sat)\n(get-model)");
const answer = await solver.check();
console.log(JSON.stringify({ answer }));
await entry.killThreads(api.em).catch(() => {});
process.exit(answer === "sat" ? 0 : 1);

import {
  analysisReasonForVerificationStatus,
  defaultAnalysisWorkerBudget,
} from "./analysisTasks.js";
import { scheduleAnalysisWorker } from "./analysisWorkerQueue.js";
import { isNodeLikeSystem } from "./core.js";
import {
  AnalysisTaskReason,
  CancellationToken,
  VerificationStatus,
} from "./types.js";
import { VerificationQueryCache } from "./verificationIncremental.js";

/** @internal */
export interface VerificationSolverResult {
  readonly status: VerificationStatus;
  readonly message: string;
  readonly counterexample?: string;
  readonly model?: string;
  readonly reason?: AnalysisTaskReason;
}

/** @internal */
export interface VerificationCacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly size: number;
}

/** @internal */
export interface VerificationWorkerBudget {
  readonly minimumTimeoutMs: number;
  readonly timeoutPerQueryMs: number;
  readonly maxOldGenerationSizeMb: number;
}

const defaultVerificationWorkerBudget: VerificationWorkerBudget = {
  minimumTimeoutMs: 30_000,
  timeoutPerQueryMs: 12_000,
  maxOldGenerationSizeMb: defaultAnalysisWorkerBudget.maxOldGenerationSizeMb,
};

const maximumCachedVerificationQueries = 2048;
const verificationResultCache = new VerificationQueryCache<VerificationSolverResult>(maximumCachedVerificationQueries);

/** @internal */
export async function runVerificationQueries(
  inputs: readonly string[],
  budget: VerificationWorkerBudget = defaultVerificationWorkerBudget,
  cancellationToken?: CancellationToken,
): Promise<readonly VerificationSolverResult[]> {
  cancellationToken?.throwIfCancellationRequested();
  const results: (VerificationSolverResult | undefined)[] = new Array(inputs.length);
  const missingInputs: string[] = [];
  const missingIndexes = new Map<string, number[]>();
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index];
    const cached = verificationResultCache.get(input);
    if (cached) {
      results[index] = cached;
      continue;
    }
    let indexes = missingIndexes.get(input);
    if (!indexes) {
      verificationResultCache.recordMiss();
      missingInputs.push(input);
      missingIndexes.set(input, indexes = []);
    }
    indexes.push(index);
  }
  if (missingInputs.length) {
    const missingResults = await scheduleAnalysisWorker(
      "compiler-analysis",
      () => runVerificationQueriesWorker(missingInputs, budget, cancellationToken),
      cancellationToken,
    );
    for (let index = 0; index < missingInputs.length; index++) {
      const input = missingInputs[index];
      const result = missingResults[index];
      if (result.status === "proved" || result.status === "failed") cacheVerificationResult(input, result);
      for (const resultIndex of missingIndexes.get(input)!) results[resultIndex] = result;
    }
  }
  return results as VerificationSolverResult[];
}

/** @internal */
export function getVerificationCacheStats(): VerificationCacheStats {
  return verificationResultCache.stats();
}

/** @internal */
export function clearVerificationCache(): void {
  verificationResultCache.clear();
}

function cacheVerificationResult(input: string, result: VerificationSolverResult): void {
  verificationResultCache.set(input, result);
}

async function runVerificationQueriesWorker(
  inputs: readonly string[],
  budget: VerificationWorkerBudget,
  cancellationToken: CancellationToken | undefined,
): Promise<readonly VerificationSolverResult[]> {
  try {
    // `typeof require !== "function"` is unreliable in the esbuild browser bundle:
    // bare `require` becomes a Proxy-based shim whose typeof is still "function",
    // so the require("node:worker_threads") below would throw a confusing
    // "Dynamic require of ..." error instead of the clean unavailable result.
    if (!isNodeLikeSystem()) return inputs.map(() => unavailableResult("Z3 is unavailable in this runtime."));
    const { Worker } = require("node:worker_threads") as typeof import("node:worker_threads");
    const z3Path = require.resolve("z3-solver");
    return await new Promise<readonly VerificationSolverResult[]>((resolve, reject) => {
      let settled = false;
      const worker = new Worker(z3WorkerScript, {
        eval: true,
        workerData: { inputs, z3Path },
        resourceLimits: { maxOldGenerationSizeMb: budget.maxOldGenerationSizeMb },
      });
      const timer = globalThis.setTimeout(() => {
        if (settled) return;
        settled = true;
        if (cancellationPoll) globalThis.clearInterval(cancellationPoll);
        void worker.terminate();
        resolve(inputs.map(() => timedOutResult("Z3 verification worker timed out.")));
      }, Math.max(budget.minimumTimeoutMs, inputs.length * budget.timeoutPerQueryMs));
      const cancellationPoll = cancellationToken && globalThis.setInterval(() => {
        if (settled || !cancellationToken.isCancellationRequested()) return;
        settled = true;
        globalThis.clearTimeout(timer);
        globalThis.clearInterval(cancellationPoll);
        void worker.terminate();
        resolve(inputs.map(() => cancelledResult("Z3 verification was cancelled.")));
      }, 25);
      worker.once("message", (message: { ok: boolean; results?: VerificationSolverResult[]; error?: string; }) => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        if (cancellationPoll) globalThis.clearInterval(cancellationPoll);
        void worker.terminate();
        if (message.ok && message.results) resolve(message.results.map(withStructuredReason));
        else reject(new Error(message.error ?? "Z3 verification worker failed."));
      });
      worker.once("error", error => {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        if (cancellationPoll) globalThis.clearInterval(cancellationPoll);
        void worker.terminate();
        reject(error);
      });
    });
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return inputs.map(() => unavailableResult(`Z3 could not run: ${message}`));
  }
}

function timedOutResult(message: string): VerificationSolverResult {
  return { status: "unknown", message, reason: { code: "timeout", message } };
}

function cancelledResult(message: string): VerificationSolverResult {
  return { status: "unknown", message, reason: { code: "cancelled", message } };
}

function unavailableResult(message: string): VerificationSolverResult {
  return { status: "unknown", message, reason: { code: "unavailable", message } };
}

function withStructuredReason(result: VerificationSolverResult): VerificationSolverResult {
  return { ...result, reason: result.reason ?? analysisReasonForVerificationStatus(result.status, result.message) };
}

const z3WorkerScript = String.raw`
const { parentPort, workerData } = require("node:worker_threads");

async function run() {
  const z3 = require(workerData.z3Path);
  const api = await z3.init();
  const context = new api.Context("tspp-verification");
  const results = [];
  for (const input of workerData.inputs) {
    try {
      const solver = new context.Solver();
      solver.fromString(input);
      const answer = await solver.check();
      if (answer === "unsat") results.push({ status: "proved", message: "Z3 proved the negated obligation unsatisfiable." });
      else if (answer === "sat") {
        const modelObject = solver.model();
        const model = modelObject.toString();
        const metadataMatch = input.match(/^; tspp-model (.+)$/m);
        const metadata = metadataMatch ? JSON.parse(metadataMatch[1]) : { declarations: [], sorts: [] };
        const definitions = parseModelDefinitions(model);
        const selected = metadata.declarations.filter(declaration => definitions.has(declaration.symbol) || declaration.sort === "Int" || declaration.sort === "Real" || declaration.sort === "Bool" || declaration.sort === "String");
        const duplicateSourceNames = new Set();
        const seenSourceNames = new Set();
        for (const declaration of selected) {
          const sourceName = declaration.sourceName;
          if (seenSourceNames.has(sourceName)) duplicateSourceNames.add(sourceName);
          seenSourceNames.add(sourceName);
        }
        const sorts = new Map(metadata.sorts.map(sort => [sort.sort, sort]));
        const assignments = selected.map(declaration => {
          const sourceName = declaration.sourceName;
          const label = duplicateSourceNames.has(sourceName) ? sourceName + " (" + declaration.symbol + ")" : sourceName;
          let modelValue = definitions.get(declaration.symbol);
          if (modelValue === undefined && (declaration.sort === "Int" || declaration.sort === "Real" || declaration.sort === "Bool" || declaration.sort === "String")) {
            modelValue = modelObject.eval(context[declaration.sort].const(declaration.symbol), true).toString();
          }
          const value = formatModelValue(modelValue, declaration.sort, sorts);
          return label + " = " + value;
        });
        results.push({ status: "failed", message: "Z3 found a counterexample.", counterexample: assignments.join(", ") || "the obligation is false for every assignment", model });
      }
      else results.push({ status: "unknown", message: "Z3 returned unknown: " + solver.reasonUnknown() });
    }
    catch (error) {
      results.push({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

function tokenizeSExpressions(text) {
  return text.match(/\(|\)|\|(?:\\.|[^|])*\||"(?:""|[^"])*"|[^\s()]+/g) || [];
}

function parseSExpressions(text) {
  const tokens = tokenizeSExpressions(text);
  let index = 0;
  function parse() {
    const token = tokens[index++];
    if (token !== "(") return token;
    const result = [];
    while (index < tokens.length && tokens[index] !== ")") result.push(parse());
    index++;
    return result;
  }
  const result = [];
  while (index < tokens.length) result.push(parse());
  return result;
}

function parseModelDefinitions(model) {
  const definitions = new Map();
  function visit(value) {
    if (!Array.isArray(value)) return;
    if (value[0] === "define-fun" && value.length >= 5 && Array.isArray(value[2]) && value[2].length === 0) definitions.set(value[1], value[4]);
    else for (const child of value) visit(child);
  }
  for (const expression of parseSExpressions(model)) visit(expression);
  return definitions;
}

function formatModelValue(value, sortName, sorts) {
  const structured = sorts.get(sortName);
  if (!structured) return formatPrimitiveModelValue(value);
  if (!Array.isArray(value)) return formatPrimitiveModelValue(value);
  const normalize = name => typeof name === "string" && name.startsWith("|") && name.endsWith("|") ? name.slice(1, -1) : name;
  const variant = structured.variants.find(candidate => normalize(candidate.constructor) === normalize(value[0]));
  if (!variant) return formatSExpression(value);
  const fields = variant.fields.map((field, index) => field.name + ": " + formatModelValue(value[index + 1], field.sort, sorts));
  if (structured.kind === "sum") fields.unshift('_tag: "' + variant.name.replace(/"/g, '\\"') + '"');
  return "{ " + fields.join(", ") + " }";
}

function formatPrimitiveModelValue(value) {
  if (Array.isArray(value) && value[0] === "-" && value.length === 2) return "-" + formatPrimitiveModelValue(value[1]);
  if (Array.isArray(value) && value[0] === "/" && value.length === 3) return formatPrimitiveModelValue(value[1]) + "/" + formatPrimitiveModelValue(value[2]);
  if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) return JSON.stringify(value.slice(1, -1).replace(/""/g, '"'));
  return formatSExpression(value);
}

function formatSExpression(value) {
  return Array.isArray(value) ? "(" + value.map(formatSExpression).join(" ") + ")" : String(value);
}

run().then(
  results => parentPort.postMessage({ ok: true, results }),
  error => parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }),
);
`;

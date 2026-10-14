import {
  analysisReasonForVerificationStatus,
  defaultAnalysisWorkerBudget,
} from "./analysisTasks.js";
import { scheduleAnalysisWorker } from "./analysisWorkerQueue.js";
import {
  AnalysisTaskReason,
  VerificationStatus,
} from "./types.js";

/** @internal */
export interface VerificationSolverResult {
  readonly status: VerificationStatus;
  readonly message: string;
  readonly counterexample?: string;
  readonly model?: string;
  readonly reason?: AnalysisTaskReason;
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

/** @internal */
export async function runVerificationQueries(
  inputs: readonly string[],
  budget: VerificationWorkerBudget = defaultVerificationWorkerBudget,
): Promise<readonly VerificationSolverResult[]> {
  return scheduleAnalysisWorker("compiler-analysis", () => runVerificationQueriesWorker(inputs, budget));
}

async function runVerificationQueriesWorker(
  inputs: readonly string[],
  budget: VerificationWorkerBudget,
): Promise<readonly VerificationSolverResult[]> {
  try {
    if (typeof require !== "function") return inputs.map(() => unavailableResult("Z3 is unavailable in this runtime."));
    const { Worker } = require("node:worker_threads") as typeof import("node:worker_threads");
    const z3Path = require.resolve("z3-solver");
    return await new Promise<readonly VerificationSolverResult[]>((resolve, reject) => {
      const worker = new Worker(z3WorkerScript, {
        eval: true,
        workerData: { inputs, z3Path },
        resourceLimits: { maxOldGenerationSizeMb: budget.maxOldGenerationSizeMb },
      });
      const timer = globalThis.setTimeout(() => {
        void worker.terminate();
        reject(new Error("Z3 verification worker timed out."));
      }, Math.max(budget.minimumTimeoutMs, inputs.length * budget.timeoutPerQueryMs));
      worker.once("message", (message: { ok: boolean; results?: VerificationSolverResult[]; error?: string; }) => {
        globalThis.clearTimeout(timer);
        void worker.terminate();
        if (message.ok && message.results) resolve(message.results.map(withStructuredReason));
        else reject(new Error(message.error ?? "Z3 verification worker failed."));
      });
      worker.once("error", error => {
        globalThis.clearTimeout(timer);
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

function unavailableResult(message: string): VerificationSolverResult {
  return { status: "unknown", message, reason: { code: "unavailable", message } };
}

function withStructuredReason(result: VerificationSolverResult): VerificationSolverResult {
  return { ...result, reason: analysisReasonForVerificationStatus(result.status, result.message) };
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
        const declarations = [...input.matchAll(/\(declare-const\s+([^\s()]+)\s+(Int|Real|Bool|String)\)/g)];
        const sourceNames = new Map([...input.matchAll(/^;\s*([^\s=]+)\s*=\s*(.+)$/gm)].map(match => [match[1], match[2].trim()]));
        const modeledNames = new Set([...model.matchAll(/\(define-fun\s+([^\s()]+)/g)].map(match => match[1]));
        const selected = modeledNames.size ? declarations.filter(match => modeledNames.has(match[1])) : declarations;
        const duplicateSourceNames = new Set();
        const seenSourceNames = new Set();
        for (const match of selected) {
          const sourceName = sourceNames.get(match[1]) || match[1];
          if (seenSourceNames.has(sourceName)) duplicateSourceNames.add(sourceName);
          seenSourceNames.add(sourceName);
        }
        const assignments = selected.map(match => {
          const [, symbolName, sort] = match;
          const sourceName = sourceNames.get(symbolName) || symbolName;
          const label = duplicateSourceNames.has(sourceName) ? sourceName + " (" + symbolName + ")" : sourceName;
          const symbol = context[sort].const(symbolName);
          const value = modelObject.eval(symbol, true).toString()
            .replace(/^\(-\s+([^()\s]+)\)$/, "-$1")
            .replace(/^\(\/\s+([^()\s]+)\s+([^()\s]+)\)$/, "$1/$2");
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

run().then(
  results => parentPort.postMessage({ ok: true, results }),
  error => parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }),
);
`;

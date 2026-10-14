import {
  AnalysisTaskOutcome,
  AnalysisTaskReason,
  VerificationStatus,
} from "./types.js";

/**
 * Shared task identity and outcome helpers for compiler-hosted analyses.
 * This module deliberately does not depend on the parser, checker, or a solver.
 *
 * @internal
 */

export function createAnalysisTaskId(
  taskKind: "verification" | "macro" | "mltt",
  fileName: string,
  start: number,
  length: number,
  name: string,
): string {
  let hash = 2166136261;
  const text = `${taskKind}\0${fileName}\0${start}\0${length}\0${name}`;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${taskKind}:${(hash >>> 0).toString(16)}`;
}

export function verificationStatusToAnalysisOutcome(status: VerificationStatus): AnalysisTaskOutcome {
  switch (status) {
    case "proved":
      return "succeeded";
    case "failed":
      return "failed";
    case "unknown":
      return "unknown";
    case "error":
      return "error";
  }
}

/** Resource limits shared by compiler analysis workers. @internal */
export interface AnalysisWorkerBudget {
  readonly maxOldGenerationSizeMb: number;
  readonly startupTimeoutMs: number;
  readonly cancellationGraceMs: number;
}

/** @internal */
export const defaultAnalysisWorkerBudget: AnalysisWorkerBudget = {
  maxOldGenerationSizeMb: 256,
  startupTimeoutMs: 60_000,
  cancellationGraceMs: 100,
};

/** @internal */
export function analysisReasonForVerificationStatus(status: VerificationStatus, message: string): AnalysisTaskReason | undefined {
  switch (status) {
    case "proved":
    case "failed":
      return undefined;
    case "unknown":
      return { code: message.includes("unavailable") || message.includes("could not run") ? "unavailable" : "solver-unknown", message };
    case "error":
      return { code: "execution-error", message };
  }
}

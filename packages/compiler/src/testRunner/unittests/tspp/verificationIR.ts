import {
  verificationApplication,
  verificationConstant,
  verificationInteger,
  verificationIsVariant,
  verificationSelect,
  VerificationSumSort,
} from "../../../compiler/verificationIR.js";
import { encodeVerificationProblem } from "../../../compiler/verificationSmt.js";
import {
  clearVerificationCache,
  getVerificationCacheStats,
  runVerificationQueries,
} from "../../../compiler/verificationWorker.js";

describe("unittests:: tspp:: verification IR", () => {
  it("encodes closed sum sorts as SMT datatypes", async () => {
    const resultSort: VerificationSumSort = {
      kind: "sum",
      name: "Result",
      variants: [
        { name: "Success", fields: [{ name: "value", sort: "Int" }] },
        { name: "Failure", fields: [{ name: "code", sort: "Int" }] },
      ],
    };
    const result = verificationConstant("result", resultSort);
    const isSuccess = verificationIsVariant(result, resultSort, "Success");
    const successValue = verificationSelect(result, resultSort, "value", "Success");
    const problem = {
      declarations: [{ name: "result", sort: resultSort, sourceName: "result" }],
      assumptions: [isSuccess, verificationApplication(">=", successValue, verificationInteger("0"))],
      goal: isSuccess,
    };
    const encoding = encodeVerificationProblem(problem);

    assert.include(encoding.solverInput, "(declare-datatypes");
    assert.include(encoding.solverInput, "tspp.ctor");
    assert.include(encoding.solverInput, "((_ is");
    assert.include(encoding.solverInput, "tspp.field");
    assert.equal((await runVerificationQueries([encoding.solverInput]))[0].status, "proved");
  });

  it("rejects malformed structured sorts before invoking Z3", () => {
    const malformed: VerificationSumSort = {
      kind: "sum",
      name: "Duplicate",
      variants: [
        { name: "Same", fields: [] },
        { name: "Same", fields: [] },
      ],
    };
    assert.throws(() => encodeVerificationProblem({ declarations: [{ name: "value", sort: malformed }], assumptions: [], goal: verificationApplication("=", verificationInteger("0"), verificationInteger("0")) }), "Duplicate variant");
  });

  it("encodes recursive datatypes", async () => {
    const list = { kind: "sum", name: "List", variants: [] } as unknown as VerificationSumSort;
    (list as { variants: VerificationSumSort["variants"]; }).variants = [
      { name: "Nil", fields: [] },
      { name: "Cons", fields: [{ name: "head", sort: "Int" }, { name: "tail", sort: list }] },
    ];
    const value = verificationConstant("value", list);
    const encoding = encodeVerificationProblem({
      declarations: [{ name: "value", sort: list, sourceName: "value" }],
      assumptions: [],
      goal: verificationApplication("or", verificationIsVariant(value, list, "Nil"), verificationIsVariant(value, list, "Cons")),
    });
    assert.equal((await runVerificationQueries([encoding.solverInput]))[0].status, "proved");
  });

  it("reuses content-addressed verification results", async () => {
    clearVerificationCache();
    const input = encodeVerificationProblem({
      declarations: [],
      assumptions: [],
      goal: verificationApplication("=", verificationInteger("1"), verificationInteger("1")),
    }).solverInput;
    await runVerificationQueries([input]);
    await runVerificationQueries([input]);
    assert.deepEqual(getVerificationCacheStats(), { hits: 1, misses: 1, size: 1 });
  });

  it("cancels an active solver worker", async () => {
    clearVerificationCache();
    let cancelled = false;
    const token = {
      isCancellationRequested: () => cancelled,
      throwIfCancellationRequested: () => {
        if (cancelled) throw new Error("cancelled");
      },
    };
    const input = encodeVerificationProblem({
      declarations: [],
      assumptions: [],
      goal: verificationApplication("=", verificationInteger("2"), verificationInteger("2")),
    }).solverInput;
    const pending = runVerificationQueries([input], /*budget*/ undefined, token);
    cancelled = true;
    const [result] = await pending;
    assert.equal(result.reason?.code, "cancelled");
  });

  it("reports solver worker timeouts distinctly", async () => {
    clearVerificationCache();
    const input = encodeVerificationProblem({
      declarations: [],
      assumptions: [],
      goal: verificationApplication("=", verificationInteger("3"), verificationInteger("3")),
    }).solverInput;
    const [result] = await runVerificationQueries([input], { minimumTimeoutMs: 1, timeoutPerQueryMs: 1, maxOldGenerationSizeMb: 256 });
    assert.equal(result.reason?.code, "timeout");
  });
});

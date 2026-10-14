import {
  verificationApplication,
  verificationConstant,
  verificationInteger,
  verificationIsVariant,
  verificationSelect,
  VerificationSumSort,
} from "../../../compiler/verificationIR.js";
import { encodeVerificationProblem } from "../../../compiler/verificationSmt.js";
import { runVerificationQueries } from "../../../compiler/verificationWorker.js";

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
});

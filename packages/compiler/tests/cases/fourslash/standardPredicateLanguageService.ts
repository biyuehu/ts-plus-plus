/// <reference path="fourslash.ts"/>

// @tsppFeatures: formalContracts,refinementTypes,standardLibraryPredicates
// @target: es2022

// @Filename: test.tspp
////type Positive = bigint with {
////  predicate: isP/*completion*/ositive(value);
////};
////type Even = bigint with {
////  predicate: /*quickInfo*/isEven(/*signatureHelp*/value);
////};
////const runtimeCall = /*runtimeStart*/isEven/*runtimeEnd*/(2n);

verify.completions({ marker: "completion", includes: { name: "isPositive", sortText: completion.SortText.GlobalsOrKeywords } });
verify.quickInfoExists("quickInfo");
verify.signatureHelp({
    marker: "signatureHelp",
    overloadsCount: 2,
    text: "isEven(value: bigint): boolean",
    docComment: "Compile-time-only numeric predicates provided by the\n" +
        "`standardLibraryPredicates` TS++ feature.\n\n" +
        "These declarations provide completions, signature help, and type\n" +
        "information. They may only be called in `requires`, `ensures`,\n" +
        "`predicate`, and `invariant` clauses, where the verification backend\n" +
        "lowers them to SMT operations. No JavaScript runtime functions are emitted.",
});
verify.errorExistsBetweenMarkers("runtimeStart", "runtimeEnd");
verify.numberOfErrorsInCurrentFile(1);

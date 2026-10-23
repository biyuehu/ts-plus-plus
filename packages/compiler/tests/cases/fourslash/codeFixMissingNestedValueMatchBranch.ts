/// <reference path="fourslash.ts" />

// @tsppFeatures: dataDeclarations
// @Filename: test.tspp
////data Result<T> = Ok(value: T) | Err(error: string);
////data Envelope<T> = Empty | Wrapped(result: Result<T>);
////declare const envelope: Envelope<number>;
////const selected = [|match envelope {
////  Empty => 0,
////  Wrapped(Ok(value)) => value,
////}|];

verify.codeFix({
    description: ts.Diagnostics.Add_missing_value_match_branches.message,
    newRangeContent: `match envelope {
  Empty => 0,
  Wrapped(Ok(value)) => value,
  Wrapped(result) => undefined,
}`,
});

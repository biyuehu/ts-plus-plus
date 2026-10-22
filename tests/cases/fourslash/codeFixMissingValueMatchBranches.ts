/// <reference path="fourslash.ts" />

// @tsppFeatures: dataDeclarations
// @Filename: test.tspp
////data Result<T> = Ok(value: T) | Err(error: string);
////declare const result: Result<number>;
////const selected = [|match result { Ok(value) => value }|];

verify.codeFix({
    description: ts.Diagnostics.Add_missing_value_match_branches.message,
    newRangeContent: "match result { Ok(value) => value, Err(error) => undefined }",
});

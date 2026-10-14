/// <reference path="fourslash.ts"/>

// @tsppFeatures: higherKindedTypes,typeUniverses,dependentFunctionTypes,dependentFunctionInterop,typeMatching

// @Filename: test.tspp
////type MatchValue: Type1 =
////  (A: Type0) ->
////  (value: A) ->
////  TypeMatch<
////    A,
////    Case<string, number>,
////    Case<number, string>,
////    Default<boolean>
////  >;
////declare const matchValue: MatchValue;
////declare let text: string;
////declare let count: number;
////declare let textOrCount: string | number;
////const /*textResult*/matchedText = /*textCall*/matchValue(text);
////const /*numberResult*/matchedNumber = matchValue(count);
////const /*unionResult*/matchedUnion = matchValue(textOrCount);

verify.quickInfoAt("textResult", "const matchedText: number");
verify.quickInfoAt("numberResult", "const matchedNumber: string");
verify.quickInfoAt("unionResult", "const matchedUnion: boolean");
verify.quickInfoAt("textCall", "const matchValue: <string>(value: string) => number");

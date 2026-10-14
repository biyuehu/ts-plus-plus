/// <reference path="fourslash.ts"/>

// @tsppFeatures: higherKindedTypes,typeUniverses,dependentFunctionTypes,dependentFunctionInterop,naturalNumbers,booleans,booleanElimination

// @Filename: test.tspp
////type BooleanChooser: Type0 =
////  (value: Bool) ->
////  If<
////    value,
////    Ann<Lam<(ignored: Bool) -> Type0>, (ignored: Bool) -> Type1>,
////    string,
////    number
////  >;
////declare const chooseByBoolean: BooleanChooser;
////const /*whenTrue*/chosenString = /*trueCall*/chooseByBoolean(true);
////const /*whenFalse*/chosenNumber = /*falseCall*/chooseByBoolean(false);
////declare let dynamicBoolean: boolean;
////const /*whenDynamic*/chosenUnion = /*dynamicCall*/chooseByBoolean(dynamicBoolean);

verify.quickInfoAt("whenTrue", "const chosenString: string");
verify.quickInfoAt("whenFalse", "const chosenNumber: number");
verify.quickInfoAt("whenDynamic", "const chosenUnion: string | number");
verify.quickInfoAt("trueCall", "const chooseByBoolean: <true>(value: true) => string");
verify.quickInfoAt("falseCall", "const chooseByBoolean: <false>(value: false) => number");
verify.quickInfoAt("dynamicCall", "const chooseByBoolean: <boolean>(value: boolean) => string | number");

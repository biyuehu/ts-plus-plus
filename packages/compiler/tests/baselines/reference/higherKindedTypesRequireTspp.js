//// [tests/cases/compiler/higherKindedTypesRequireTspp.ts] ////

//// [higherKindedTypesRequireTspp.ts]
export interface InvalidInTypeScript<F: Type => Type> {
    value: F<string>;
}

export type InvalidAliasInTypeScript: Type => Type = Array;


//// [higherKindedTypesRequireTspp.js]
Type => Type = Array;
export {};

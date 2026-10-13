// @strict: true
// @noEmit: true
// @tsppFeatures: higherKindedTypes,typeUniverses

// @Filename: ordinaryTypeScript.ts
export type Type = 1;
export type Type0 = 1;
export type Type1 = 1;

// @Filename: typeUniverseNamesReserved.tspp
export type Type = 1;
export type Type0 = 1;
export type Type1 = 1;

// These names do not denote universes and remain available to user code.
export type Type00 = 1;
export type Type01 = 1;

//// [tests/cases/compiler/dependentFunctionTypes.ts] ////

//// [dependentFunctionTypes.tspp]
export type PolymorphicIdentity: Type1 = (A: Type0) -> (value: A) -> A;
export type ConstantType: Type1 = (A: Type0) -> (B: Type0) -> A;
export type Shadowing: Type1 = (A: Type0) -> (A: Type0) -> A;
export type IdentityAlias: Type1 = PolymorphicIdentity;

export type WrongExpectedKind: Type0 = (A: Type0) -> A;
export type UnboundName: Type1 = (A: Type0) -> Missing;
export type UnsupportedType: Type1 = (A: Type0) -> string;

//// [ordinary.ts]
export type OrdinaryFunction = (value: string) => string;


//// [dependentFunctionTypes.js]
export {};
//// [ordinary.js]
export {};


//// [dependentFunctionTypes.d.tspp]
export type PolymorphicIdentity: Type1 = (A: Type0) -> (value: A) -> A;
export type ConstantType: Type1 = (A: Type0) -> (B: Type0) -> A;
export type Shadowing: Type1 = (A: Type0) -> (A: Type0) -> A;
export type IdentityAlias: Type1 = PolymorphicIdentity;
export type WrongExpectedKind: Type0 = (A: Type0) -> A;
export type UnboundName: Type1 = (A: Type0) -> Missing;
export type UnsupportedType: Type1 = (A: Type0) -> string;
//// [ordinary.d.ts]
export type OrdinaryFunction = (value: string) => string;

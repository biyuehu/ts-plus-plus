//// [tests/cases/compiler/dependentFunctionTypes.ts] ////

//// [dependentFunctionTypes.tspp]
type Box<T> = { value: T };

export type PolymorphicIdentity: Type1 = {A: Type0} -> (value: A) -> A;
export type ConstantType: Type1 = (A: Type0) -> (B: Type0) -> A;
export type Shadowing: Type1 = (A: Type0) -> (A: Type0) -> A;
export type IdentityAlias: Type1 = PolymorphicIdentity;

export type WrongExpectedKind: Type0 = (A: Type0) -> A;
export type UnboundName: Type1 = (A: Type0) -> Missing;
export type BuiltinType: Type1 = (A: Type0) -> string;
export type UnionType: Type1 = (A: Type0) -> A | string;
export type IntersectionType: Type1 = (A: Type0) -> A & object;
export type GenericReferenceType: Type1 = (A: Type0) -> Box<A>;
export type KeyofType: Type1 = (A: Type0) -> keyof A;
export type IndexedType: Type1 = (A: Type0) -> { value: A }["value"];
export type ConditionalType: Type1 = (A: Type0) -> A extends string ? number : boolean;
export type MappedType: Type1 = (A: Type0) -> { [K in keyof A]: A[K] };

//// [ordinary.ts]
export type OrdinaryFunction = (value: string) => string;


//// [dependentFunctionTypes.js]
export {};
//// [ordinary.js]
export {};


//// [dependentFunctionTypes.d.tspp]
type Box<T> = {
    value: T;
};
export type PolymorphicIdentity: Type1 = {A: Type0} -> (value: A) -> A;
export type ConstantType: Type1 = (A: Type0) -> (B: Type0) -> A;
export type Shadowing: Type1 = (A: Type0) -> (A: Type0) -> A;
export type IdentityAlias: Type1 = PolymorphicIdentity;
export type WrongExpectedKind: Type0 = (A: Type0) -> A;
export type UnboundName: Type1 = (A: Type0) -> Missing;
export type BuiltinType: Type1 = (A: Type0) -> string;
export type UnionType: Type1 = (A: Type0) -> A | string;
export type IntersectionType: Type1 = (A: Type0) -> A & object;
export type GenericReferenceType: Type1 = (A: Type0) -> Box<A>;
export type KeyofType: Type1 = (A: Type0) -> keyof A;
export type IndexedType: Type1 = (A: Type0) -> {
    value: A;
}["value"];
export type ConditionalType: Type1 = (A: Type0) -> A extends string ? number : boolean;
export type MappedType: Type1 = (A: Type0) -> {
    [K in keyof A]: A[K];
};
export {};
//// [dependentFunctionTypes.d.ts]
type Box<T> = {
    value: T;
};
export type PolymorphicIdentity = (A: unknown) => unknown;
export type ConstantType = (A: unknown) => unknown;
export type Shadowing = (A: unknown) => unknown;
export type IdentityAlias = PolymorphicIdentity;
export type WrongExpectedKind = (A: unknown) => unknown;
export type UnboundName = (A: unknown) => unknown;
export type BuiltinType = (A: unknown) => unknown;
export type UnionType = (A: unknown) => unknown;
export type IntersectionType = (A: unknown) => unknown;
export type GenericReferenceType = (A: unknown) => unknown;
export type KeyofType = (A: unknown) => unknown;
export type IndexedType = (A: unknown) => unknown;
export type ConditionalType = (A: unknown) => unknown;
export type MappedType = (A: unknown) => unknown;
export {};
//// [ordinary.d.ts]
export type OrdinaryFunction = (value: string) => string;

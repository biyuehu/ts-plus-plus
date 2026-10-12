// @strict: true
// @declaration: true
// @emitDeclarationOnly: true

// @Filename: higherKindedTypeAliases.tspp
export interface AcceptsUnary<F: Type => Type> {
    value: F<string>;
}

export type Pair<A, B> = [A, B];

export type ArrayConstructor: Type => Type = Array;
export type ArrayConstructorAlias: Type => Type = ArrayConstructor;
export type PairConstructor: (Type, Type) => Type = Pair;

export type StringArray = ArrayConstructor<string>;
export type NumberArray = ArrayConstructorAlias<number>;
export type PairValue = PairConstructor<string, number>;
export type AcceptedAlias = AcceptsUnary<ArrayConstructor>;

declare const strings: StringArray;
strings.push("ok");
strings.push(1);

export type OrdinaryAlias = Array;
export type MissingApplication = ArrayConstructor;
export type KindMismatch: Type => Type = string;
export type WrongArity: (Type, Type) => Type = Array;
export type HigherOrderConstructor<T>: Type => Type = Array;

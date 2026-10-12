// @strict: true
// @module: node16
// @moduleResolution: node16

// @Filename: /library.d.tspp
export interface Apply<F: Type => Type, A> {
    value: F<A>;
}

export type ArrayConstructor: Type => Type = Array;
export type UniverseZero: Type1 = Type0;

// @Filename: /consumer.tspp
import type { Apply, ArrayConstructor, UniverseZero } from "./library.d.tspp";

type ImportedArrayConstructor: UniverseZero => UniverseZero = Array;

declare const applied: Apply<Array, string>;
applied.value.push("ok");
applied.value.push(1);

declare const aliased: ArrayConstructor<number>;
aliased.push(1);
aliased.push("no");

declare const importedKindAlias: ImportedArrayConstructor<boolean>;
importedKindAlias.push(true);
importedKindAlias.push("no");

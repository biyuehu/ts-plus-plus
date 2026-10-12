// @strict: true
// @module: node16
// @moduleResolution: node16

// @Filename: /library.d.tspp
export interface Apply<F: Type => Type, A> {
    value: F<A>;
}

// @Filename: /consumer.tspp
import type { Apply } from "./library.d.tspp";

declare const applied: Apply<Array, string>;
applied.value.push("ok");
applied.value.push(1);

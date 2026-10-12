//// [tests/cases/compiler/higherKindedDeclarationResolution.ts] ////

//// [library.d.tspp]
export interface Apply<F: Type => Type, A> {
    value: F<A>;
}

//// [consumer.tspp]
import type { Apply } from "./library.d.tspp";

declare const applied: Apply<Array, string>;
applied.value.push("ok");
applied.value.push(1);


//// [consumer.js]
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
applied.value.push("ok");
applied.value.push(1);

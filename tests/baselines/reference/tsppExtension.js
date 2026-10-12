//// [tests/cases/conformance/moduleResolution/tsppExtension.ts] ////

//// [dep.tspp]
export const answer: number = 42;

//// [main.tspp]
import { answer } from "./dep";
import { answer as explicitAnswer } from "./dep.tspp";

export const doubled = answer + explicitAnswer;


//// [dep.js]
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.answer = void 0;
exports.answer = 42;
//// [main.js]
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.doubled = void 0;
const dep_1 = require("./dep");
const dep_tspp_1 = require("./dep.js");
exports.doubled = dep_1.answer + dep_tspp_1.answer;


//// [dep.d.ts]
export declare const answer: number;
//// [main.d.ts]
export declare const doubled: number;

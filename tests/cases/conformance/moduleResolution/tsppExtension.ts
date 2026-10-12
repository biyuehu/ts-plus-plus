// @target: es2020
// @module: commonjs
// @declaration: true
// @allowImportingTsExtensions: true
// @rewriteRelativeImportExtensions: true

// @Filename: /dep.tspp
export const answer: number = 42;

// @Filename: /main.tspp
import { answer } from "./dep";
import { answer as explicitAnswer } from "./dep.tspp";

export const doubled = answer + explicitAnswer;

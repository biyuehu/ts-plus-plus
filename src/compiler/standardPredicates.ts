import type {
  Node,
  SourceFile,
  Symbol,
} from "./types.js";

/** @internal */
export type StandardPredicateName =
  | "isEven"
  | "isOdd"
  | "isPositive"
  | "isNegative"
  | "isNonNegative"
  | "isZero"
  | "divides"
  | "between";

/** @internal */
export type StandardPredicateKind =
  | "even"
  | "odd"
  | "positive"
  | "negative"
  | "nonNegative"
  | "zero"
  | "divides"
  | "between";

/** @internal */
export interface StandardPredicateDefinition {
  readonly name: StandardPredicateName;
  readonly kind: StandardPredicateKind;
  readonly arity: number;
}

/** @internal */

export const standardPredicateDefinitions: readonly StandardPredicateDefinition[] = [
  { name: "isEven", kind: "even", arity: 1 },
  { name: "isOdd", kind: "odd", arity: 1 },
  { name: "isPositive", kind: "positive", arity: 1 },
  { name: "isNegative", kind: "negative", arity: 1 },
  { name: "isNonNegative", kind: "nonNegative", arity: 1 },
  { name: "isZero", kind: "zero", arity: 1 },
  { name: "divides", kind: "divides", arity: 2 },
  { name: "between", kind: "between", arity: 3 },
];

const standardPredicateMap = new Map<string, StandardPredicateDefinition>(
  standardPredicateDefinitions.map(definition => [definition.name, definition]),
);

/** @internal */
export function getStandardPredicateDefinition(name: string): StandardPredicateDefinition | undefined {
  return standardPredicateMap.get(name);
}

/** @internal */
export function isStandardPredicateSymbol(symbol: Symbol | undefined): boolean {
  if (!symbol) return false;
  // A declarationless symbol is synthesized by the checker for noLib hosts.
  if (!symbol.declarations?.length) return true;
  return symbol.declarations.some(declaration => {
    let root: Node = declaration;
    while (root.parent) root = root.parent;
    const sourceFile = root as SourceFile;
    const fileName = sourceFile.fileName.replace(/\\/g, "/");
    return fileName === "lib.tspp.d.ts" || fileName.endsWith("/lib.tspp.d.ts");
  });
}

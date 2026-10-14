/** @internal */
export type StandardPredicateName =
  | "isEven"
  | "isOdd"
  | "isPositive"
  | "isNonNegative"
  | "isZero"
  | "divides"
  | "between";

/** @internal */
export type StandardPredicateKind =
  | "even"
  | "odd"
  | "positive"
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

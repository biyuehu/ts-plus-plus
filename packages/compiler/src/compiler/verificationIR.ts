/**
 * Solver-independent logical IR shared by formal contracts and refinement checks.
 * This module deliberately has no dependency on the TypeScript AST or on Z3.
 *
 * @internal
 */

export type VerificationPrimitiveSort = "Bool" | "Int" | "Real" | "String";

export interface VerificationField {
  readonly name: string;
  readonly sort: VerificationSort;
}

export interface VerificationProductSort {
  readonly kind: "product";
  readonly name: string;
  readonly fields: readonly VerificationField[];
}

export interface VerificationVariant {
  readonly name: string;
  readonly fields: readonly VerificationField[];
}

export interface VerificationSumSort {
  readonly kind: "sum";
  readonly name: string;
  readonly variants: readonly VerificationVariant[];
}

/**
 * A closed verification type. Structured sorts are intentionally nominal in
 * the IR: TypeScript structural compatibility is resolved before lowering.
 */
export type VerificationSort = VerificationPrimitiveSort | VerificationProductSort | VerificationSumSort;

export type VerificationExpression =
  | { readonly kind: "constant"; readonly name: string; readonly sort: VerificationSort; }
  | { readonly kind: "boolean"; readonly value: boolean; }
  | { readonly kind: "integer"; readonly value: string; }
  | { readonly kind: "real"; readonly value: string; }
  | { readonly kind: "string"; readonly value: string; }
  | { readonly kind: "construct"; readonly sort: VerificationProductSort | VerificationSumSort; readonly variant?: string; readonly fields: readonly VerificationExpression[]; }
  | { readonly kind: "select"; readonly target: VerificationExpression; readonly sort: VerificationProductSort | VerificationSumSort; readonly field: string; readonly variant?: string; }
  | { readonly kind: "is-variant"; readonly target: VerificationExpression; readonly sort: VerificationSumSort; readonly variant: string; }
  | { readonly kind: "application"; readonly operator: VerificationOperator; readonly operands: readonly VerificationExpression[]; };

export type VerificationOperator =
  | "+"
  | "-"
  | "*"
  | "mod"
  | "is_int"
  | "to_int"
  | "="
  | "<"
  | "<="
  | ">"
  | ">="
  | "and"
  | "or"
  | "not";

export interface VerificationTerm {
  readonly expression: VerificationExpression;
  readonly sort: VerificationSort;
}

export interface VerificationDeclaration {
  readonly name: string;
  readonly sort: VerificationSort;
  readonly sourceName?: string;
}

export interface VerificationProblem {
  readonly structuredSorts?: readonly (VerificationProductSort | VerificationSumSort)[];
  readonly declarations: readonly VerificationDeclaration[];
  readonly assumptions: readonly VerificationExpression[];
  readonly goal: VerificationExpression;
}

export function verificationConstant(name: string, sort: VerificationSort): VerificationExpression {
  return { kind: "constant", name, sort };
}

export function verificationBoolean(value: boolean): VerificationExpression {
  return { kind: "boolean", value };
}

export function verificationInteger(value: string): VerificationExpression {
  return { kind: "integer", value };
}

export function verificationReal(value: string): VerificationExpression {
  return { kind: "real", value };
}

export function verificationString(value: string): VerificationExpression {
  return { kind: "string", value };
}

export function verificationApplication(operator: VerificationOperator, ...operands: readonly VerificationExpression[]): VerificationExpression {
  return { kind: "application", operator, operands };
}

export function verificationConstruct(
  sort: VerificationProductSort | VerificationSumSort,
  fields: readonly VerificationExpression[],
  variant?: string,
): VerificationExpression {
  return { kind: "construct", sort, variant, fields };
}

export function verificationSelect(
  target: VerificationExpression,
  sort: VerificationProductSort | VerificationSumSort,
  field: string,
  variant?: string,
): VerificationExpression {
  return { kind: "select", target, sort, field, variant };
}

export function verificationIsVariant(
  target: VerificationExpression,
  sort: VerificationSumSort,
  variant: string,
): VerificationExpression {
  return { kind: "is-variant", target, sort, variant };
}

export function isVerificationPrimitiveSort(sort: VerificationSort): sort is VerificationPrimitiveSort {
  return typeof sort === "string";
}

export function isVerificationNumericSort(sort: VerificationSort): sort is "Int" | "Real" {
  return sort === "Int" || sort === "Real";
}

/**
 * Sort keys are requested once per encoded expression node and per sort
 * comparison, so every structured sort object caches its key after the first
 * traversal. A key computed at the top of a traversal always starts from an
 * empty active path, which makes it a pure function of the sort object and
 * therefore cacheable even for recursive sorts. Keys computed for a nested
 * field depend on the active path (they contain `ref:` markers), so a nested
 * traversal only caches a key when its own subtree did not reference an
 * enclosing sort.
 */
const structuredSortRootKeys = new WeakMap<VerificationProductSort | VerificationSumSort, string>();
const structuredSortKeys = new WeakMap<VerificationProductSort | VerificationSumSort, string>();

interface SortKeyResult {
  readonly key: string;
  readonly sawReference: boolean;
}

export function verificationSortKey(sort: VerificationSort): string {
  if (typeof sort === "string") return sort;
  let key = structuredSortRootKeys.get(sort);
  if (key === undefined) structuredSortRootKeys.set(sort, key = sortKeyWorker(sort, new Set()).key);
  return key;
}

function sortKeyWorker(sort: VerificationSort, active: Set<VerificationProductSort | VerificationSumSort>): SortKeyResult {
  if (typeof sort === "string") return { key: sort, sawReference: false };
  const cached = structuredSortKeys.get(sort);
  if (cached !== undefined) return { key: cached, sawReference: false };
  if (active.has(sort)) return { key: `ref:${sort.kind}:${sort.name}`, sawReference: true };
  active.add(sort);
  const trace = { sawReference: false };
  const members = sort.kind === "product"
    ? sort.fields.map(field => fieldKeyText(field, active, trace)).join(",")
    : sort.variants.map(variant => `${variant.name}(${variant.fields.map(field => fieldKeyText(field, active, trace)).join(",")})`).join("|");
  active.delete(sort);
  const key = `${sort.kind}:${sort.name}:${members}`;
  if (!trace.sawReference) structuredSortKeys.set(sort, key);
  return { key, sawReference: trace.sawReference };
}

function fieldKeyText(
  field: VerificationField,
  active: Set<VerificationProductSort | VerificationSumSort>,
  trace: { sawReference: boolean; },
): string {
  const fieldKey = sortKeyWorker(field.sort, active);
  trace.sawReference ||= fieldKey.sawReference;
  return `${field.name}:${fieldKey.key}`;
}

export function verificationSortsEqual(left: VerificationSort, right: VerificationSort): boolean {
  return left === right || verificationSortKey(left) === verificationSortKey(right);
}

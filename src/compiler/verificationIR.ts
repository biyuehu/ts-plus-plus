/**
 * Solver-independent logical IR shared by formal contracts and refinement checks.
 * This module deliberately has no dependency on the TypeScript AST or on Z3.
 *
 * @internal
 */

export type VerificationSort = "Bool" | "Int" | "Real";

export type VerificationExpression =
  | { readonly kind: "constant"; readonly name: string; readonly sort: VerificationSort; }
  | { readonly kind: "boolean"; readonly value: boolean; }
  | { readonly kind: "integer"; readonly value: string; }
  | { readonly kind: "real"; readonly value: string; }
  | { readonly kind: "application"; readonly operator: VerificationOperator; readonly operands: readonly VerificationExpression[]; };

export type VerificationOperator =
  | "+"
  | "-"
  | "*"
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

export function verificationApplication(operator: VerificationOperator, ...operands: readonly VerificationExpression[]): VerificationExpression {
  return { kind: "application", operator, operands };
}

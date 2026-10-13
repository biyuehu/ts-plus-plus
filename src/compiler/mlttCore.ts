/**
 * A small, independent Martin-Lof type theory core.
 *
 * Terms use de Bruijn indices. This module deliberately has no dependency on
 * the TypeScript assignability relation: elaborated TS++ terms will eventually
 * target this core, keeping definitional equality and normalization isolated
 * from the structural type checker.
 *
 * @internal
 */

export type MlttTerm = MlttUniverse | MlttNatType | MlttZero | MlttSuccessor | MlttVariable | MlttPi | MlttLambda | MlttApplication | MlttAnnotation | MlttExternal;

export interface MlttUniverse {
  readonly kind: "universe";
  readonly level: number;
}

/** The built-in type of unary natural numbers. */
export interface MlttNatType {
  readonly kind: "nat-type";
}

/** The zero constructor of Nat. */
export interface MlttZero {
  readonly kind: "zero";
}

/** The successor constructor of Nat. */
export interface MlttSuccessor {
  readonly kind: "successor";
  readonly predecessor: MlttTerm;
}

export interface MlttVariable {
  readonly kind: "variable";
  /** Zero refers to the nearest enclosing binder. */
  readonly index: number;
}

export interface MlttPi {
  readonly kind: "pi";
  readonly parameterName: string;
  readonly domain: MlttTerm;
  /** The bound parameter is variable zero in the codomain. */
  readonly codomain: MlttTerm;
}

export interface MlttLambda {
  readonly kind: "lambda";
  readonly parameterName: string;
  /** The bound parameter is variable zero in the body. */
  readonly body: MlttTerm;
}

export interface MlttApplication {
  readonly kind: "application";
  readonly functionTerm: MlttTerm;
  readonly argument: MlttTerm;
}

export interface MlttAnnotation {
  readonly kind: "annotation";
  readonly term: MlttTerm;
  readonly type: MlttTerm;
}

/**
 * A TypeScript type checked by the host checker and embedded in the MLTT term.
 * `arguments` records references to MLTT binders so substitution still works.
 */
export interface MlttExternal {
  readonly kind: "external";
  readonly key: string;
  readonly displayName: string;
  readonly arguments: readonly MlttTerm[];
  readonly type: MlttTerm;
  /** Host-owned semantic identity. The independent core only passes it to an equality callback. */
  readonly identity?: unknown;
}

export type MlttExternalEqualityComparer = (left: MlttExternal, right: MlttExternal) => boolean;

/** Types for free variables, ordered from the nearest binder outwards. */
export type MlttContext = readonly MlttTerm[];

export class MlttTypeError extends Error {
  readonly code: "cannot-infer-lambda" | "expected-function" | "expected-type" | "invalid-level" | "type-mismatch" | "unbound-variable";

  constructor(code: MlttTypeError["code"], message: string) {
    super(message);
    this.name = "MlttTypeError";
    this.code = code;
  }
}

export function mlttUniverse(level: number): MlttUniverse {
  if (!Number.isSafeInteger(level) || level < 0) {
    throw new MlttTypeError("invalid-level", `Universe level must be a non-negative safe integer; received ${level}.`);
  }
  return { kind: "universe", level };
}

export function mlttNatType(): MlttNatType {
  return { kind: "nat-type" };
}

export function mlttZero(): MlttZero {
  return { kind: "zero" };
}

export function mlttSuccessor(predecessor: MlttTerm): MlttSuccessor {
  return { kind: "successor", predecessor };
}

export function mlttVariable(index: number): MlttVariable {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError(`Variable index must be a non-negative safe integer; received ${index}.`);
  }
  return { kind: "variable", index };
}

export function mlttPi(parameterName: string, domain: MlttTerm, codomain: MlttTerm): MlttPi {
  return { kind: "pi", parameterName, domain, codomain };
}

export function mlttLambda(parameterName: string, body: MlttTerm): MlttLambda {
  return { kind: "lambda", parameterName, body };
}

export function mlttApplication(functionTerm: MlttTerm, argument: MlttTerm): MlttApplication {
  return { kind: "application", functionTerm, argument };
}

export function mlttAnnotation(term: MlttTerm, type: MlttTerm): MlttAnnotation {
  return { kind: "annotation", term, type };
}

export function mlttExternal(
  key: string,
  displayName: string,
  arguments_: readonly MlttTerm[],
  type: MlttTerm,
  identity?: unknown,
): MlttExternal {
  return { kind: "external", key, displayName, arguments: arguments_, type, identity };
}

/** Infer the type of a core term. Lambdas require an expected type or an annotation. */
export function inferMlttType(term: MlttTerm, context: MlttContext = []): MlttTerm {
  switch (term.kind) {
    case "universe":
      return mlttUniverse(term.level + 1);

    case "nat-type":
      return mlttUniverse(0);

    case "zero":
      return mlttNatType();

    case "successor":
      checkMlttType(term.predecessor, mlttNatType(), context);
      return mlttNatType();

    case "variable": {
      const type = context[term.index];
      if (!type) {
        throw new MlttTypeError("unbound-variable", `Variable ${term.index} is not bound in a context of size ${context.length}.`);
      }
      // A binding was recorded before each binder between it and this use.
      return shiftMlttTerm(type, term.index + 1);
    }

    case "pi": {
      const domainLevel = inferMlttUniverseLevel(term.domain, context);
      const codomainLevel = inferMlttUniverseLevel(term.codomain, extendContext(context, term.domain));
      return mlttUniverse(Math.max(domainLevel, codomainLevel));
    }

    case "lambda":
      throw new MlttTypeError("cannot-infer-lambda", "Cannot infer a lambda type without an expected Pi type or an annotation.");

    case "application": {
      const functionType = weakHeadNormalizeMltt(inferMlttType(term.functionTerm, context));
      if (functionType.kind !== "pi") {
        throw new MlttTypeError("expected-function", `Expected a function type, but found ${printMlttTerm(functionType)}.`);
      }
      checkMlttType(term.argument, functionType.domain, context);
      return substituteMlttTop(term.argument, functionType.codomain);
    }

    case "annotation":
      inferMlttUniverseLevel(term.type, context);
      checkMlttType(term.term, term.type, context);
      return term.type;

    case "external":
      return term.type;
  }
}

/** Check a term against an expected type. */
export function checkMlttType(term: MlttTerm, expectedType: MlttTerm, context: MlttContext = []): void {
  const normalizedExpected = weakHeadNormalizeMltt(expectedType);
  if (term.kind === "lambda" && normalizedExpected.kind === "pi") {
    checkMlttType(term.body, normalizedExpected.codomain, extendContext(context, normalizedExpected.domain));
    return;
  }

  const actualType = inferMlttType(term, context);
  if (!areMlttTermsDefinitionallyEqual(actualType, expectedType)) {
    throw new MlttTypeError(
      "type-mismatch",
      `Expected ${printMlttTerm(expectedType)}, but inferred ${printMlttTerm(actualType)}.`,
    );
  }
}

/** Reduce only far enough to expose the outer constructor. */
export function weakHeadNormalizeMltt(term: MlttTerm): MlttTerm {
  let current = term;
  while (true) {
    if (current.kind === "annotation") {
      current = current.term;
      continue;
    }
    if (current.kind !== "application") return current;

    const functionTerm = weakHeadNormalizeMltt(current.functionTerm);
    if (functionTerm.kind !== "lambda") {
      return functionTerm === current.functionTerm ? current : mlttApplication(functionTerm, current.argument);
    }
    current = substituteMlttTop(current.argument, functionTerm.body);
  }
}

/** Compute a beta-normal form. Binder names are retained only for diagnostics. */
export function normalizeMlttTerm(term: MlttTerm): MlttTerm {
  const head = weakHeadNormalizeMltt(term);
  switch (head.kind) {
    case "universe":
    case "nat-type":
    case "zero":
    case "variable":
      return head;
    case "successor":
      return mlttSuccessor(normalizeMlttTerm(head.predecessor));
    case "pi":
      return mlttPi(head.parameterName, normalizeMlttTerm(head.domain), normalizeMlttTerm(head.codomain));
    case "lambda":
      return mlttLambda(head.parameterName, normalizeMlttTerm(head.body));
    case "application":
      return mlttApplication(normalizeMlttTerm(head.functionTerm), normalizeMlttTerm(head.argument));
    case "annotation":
      // weakHeadNormalizeMltt always removes an outer annotation.
      return normalizeMlttTerm(head.term);
    case "external":
      return mlttExternal(head.key, head.displayName, head.arguments.map(normalizeMlttTerm), normalizeMlttTerm(head.type), head.identity);
  }
}

/** Definitional equality currently consists of alpha and beta equality. */
export function areMlttTermsDefinitionallyEqual(
  left: MlttTerm,
  right: MlttTerm,
  compareExternal?: MlttExternalEqualityComparer,
): boolean {
  return structurallyEqualMlttTerms(normalizeMlttTerm(left), normalizeMlttTerm(right), compareExternal);
}

export function printMlttTerm(term: MlttTerm): string {
  return printMlttTermWorker(term, []);
}

function inferMlttUniverseLevel(term: MlttTerm, context: MlttContext): number {
  const type = weakHeadNormalizeMltt(inferMlttType(term, context));
  if (type.kind !== "universe") {
    throw new MlttTypeError("expected-type", `Expected a type, but ${printMlttTerm(term)} has type ${printMlttTerm(type)}.`);
  }
  return type.level;
}

function extendContext(context: MlttContext, type: MlttTerm): MlttContext {
  return [type, ...context];
}

function shiftMlttTerm(term: MlttTerm, amount: number, cutoff = 0): MlttTerm {
  switch (term.kind) {
    case "universe":
    case "nat-type":
    case "zero":
      return term;
    case "successor":
      return mlttSuccessor(shiftMlttTerm(term.predecessor, amount, cutoff));
    case "variable":
      return term.index < cutoff ? term : mlttVariable(term.index + amount);
    case "pi":
      return mlttPi(term.parameterName, shiftMlttTerm(term.domain, amount, cutoff), shiftMlttTerm(term.codomain, amount, cutoff + 1));
    case "lambda":
      return mlttLambda(term.parameterName, shiftMlttTerm(term.body, amount, cutoff + 1));
    case "application":
      return mlttApplication(shiftMlttTerm(term.functionTerm, amount, cutoff), shiftMlttTerm(term.argument, amount, cutoff));
    case "annotation":
      return mlttAnnotation(shiftMlttTerm(term.term, amount, cutoff), shiftMlttTerm(term.type, amount, cutoff));
    case "external":
      return mlttExternal(
        term.key,
        term.displayName,
        term.arguments.map(argument => shiftMlttTerm(argument, amount, cutoff)),
        shiftMlttTerm(term.type, amount, cutoff),
        term.identity,
      );
  }
}

function substituteMltt(term: MlttTerm, variableIndex: number, replacement: MlttTerm, binderDepth = 0): MlttTerm {
  switch (term.kind) {
    case "universe":
    case "nat-type":
    case "zero":
      return term;
    case "successor":
      return mlttSuccessor(substituteMltt(term.predecessor, variableIndex, replacement, binderDepth));
    case "variable":
      return term.index === variableIndex + binderDepth ? shiftMlttTerm(replacement, binderDepth) : term;
    case "pi":
      return mlttPi(
        term.parameterName,
        substituteMltt(term.domain, variableIndex, replacement, binderDepth),
        substituteMltt(term.codomain, variableIndex, replacement, binderDepth + 1),
      );
    case "lambda":
      return mlttLambda(term.parameterName, substituteMltt(term.body, variableIndex, replacement, binderDepth + 1));
    case "application":
      return mlttApplication(
        substituteMltt(term.functionTerm, variableIndex, replacement, binderDepth),
        substituteMltt(term.argument, variableIndex, replacement, binderDepth),
      );
    case "annotation":
      return mlttAnnotation(
        substituteMltt(term.term, variableIndex, replacement, binderDepth),
        substituteMltt(term.type, variableIndex, replacement, binderDepth),
      );
    case "external":
      return mlttExternal(
        term.key,
        term.displayName,
        term.arguments.map(argument => substituteMltt(argument, variableIndex, replacement, binderDepth)),
        substituteMltt(term.type, variableIndex, replacement, binderDepth),
        term.identity,
      );
  }
}

function substituteMlttTop(replacement: MlttTerm, body: MlttTerm): MlttTerm {
  return shiftMlttTerm(substituteMltt(body, 0, shiftMlttTerm(replacement, 1)), -1);
}

function structurallyEqualMlttTerms(
  left: MlttTerm,
  right: MlttTerm,
  compareExternal?: MlttExternalEqualityComparer,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "universe":
      return left.level === (right as MlttUniverse).level;
    case "nat-type":
    case "zero":
      return true;
    case "successor":
      return structurallyEqualMlttTerms(left.predecessor, (right as MlttSuccessor).predecessor, compareExternal);
    case "variable":
      return left.index === (right as MlttVariable).index;
    case "pi": {
      const rightPi = right as MlttPi;
      return structurallyEqualMlttTerms(left.domain, rightPi.domain, compareExternal) && structurallyEqualMlttTerms(left.codomain, rightPi.codomain, compareExternal);
    }
    case "lambda":
      return structurallyEqualMlttTerms(left.body, (right as MlttLambda).body, compareExternal);
    case "application": {
      const rightApplication = right as MlttApplication;
      return structurallyEqualMlttTerms(left.functionTerm, rightApplication.functionTerm, compareExternal) && structurallyEqualMlttTerms(left.argument, rightApplication.argument, compareExternal);
    }
    case "annotation": {
      const rightAnnotation = right as MlttAnnotation;
      return structurallyEqualMlttTerms(left.term, rightAnnotation.term, compareExternal) && structurallyEqualMlttTerms(left.type, rightAnnotation.type, compareExternal);
    }
    case "external": {
      const rightExternal = right as MlttExternal;
      return left.arguments.length === rightExternal.arguments.length &&
        left.arguments.every((argument, index) => structurallyEqualMlttTerms(argument, rightExternal.arguments[index], compareExternal)) &&
        structurallyEqualMlttTerms(left.type, rightExternal.type, compareExternal) &&
        (compareExternal ? compareExternal(left, rightExternal) : left.key === rightExternal.key);
    }
  }
}

function printMlttTermWorker(term: MlttTerm, names: readonly string[]): string {
  switch (term.kind) {
    case "universe":
      return `Type${term.level}`;
    case "nat-type":
      return "Nat";
    case "zero":
      return "Zero";
    case "successor":
      return `Succ<${printMlttTermWorker(term.predecessor, names)}>`;
    case "variable":
      return names[term.index] ?? `#${term.index}`;
    case "pi": {
      const name = freshName(term.parameterName, names);
      return `(Pi (${name}: ${printMlttTermWorker(term.domain, names)}). ${printMlttTermWorker(term.codomain, [name, ...names])})`;
    }
    case "lambda": {
      const name = freshName(term.parameterName, names);
      return `(lambda ${name}. ${printMlttTermWorker(term.body, [name, ...names])})`;
    }
    case "application":
      return `(${printMlttTermWorker(term.functionTerm, names)} ${printMlttTermWorker(term.argument, names)})`;
    case "annotation":
      return `(${printMlttTermWorker(term.term, names)} : ${printMlttTermWorker(term.type, names)})`;
    case "external":
      return term.displayName;
  }
}

function freshName(preferredName: string, names: readonly string[]): string {
  const base = preferredName || "x";
  if (!names.includes(base)) return base;
  let suffix = 1;
  while (names.includes(`${base}${suffix}`)) suffix++;
  return `${base}${suffix}`;
}

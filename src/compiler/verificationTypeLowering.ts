import { hasProperty } from "./core.js";
import {
  SymbolFlags,
  Type,
  TypeChecker,
  TypeFlags,
  UnionType,
} from "./types.js";
import {
  VerificationField,
  VerificationProductSort,
  VerificationSort,
  VerificationSumSort,
} from "./verificationIR.js";

/** @internal */
export type VerificationTypeLoweringResult =
  | { readonly sort: VerificationSort; }
  | { readonly reason: string; };

/** @internal */
export function verificationTypeLoweringFailed(result: VerificationTypeLoweringResult): result is { readonly reason: string; } {
  return hasProperty(result, "reason");
}

/** @internal */
export interface VerificationTypeLoweringContext {
  readonly checker: TypeChecker;
  readonly numberModel: boolean;
}

/**
 * Lowers the type already computed by the TypeScript checker. This layer does
 * not reproduce control-flow narrowing or structural compatibility rules.
 *
 * @internal
 */
export function lowerVerificationType(context: VerificationTypeLoweringContext, type: Type): VerificationTypeLoweringResult {
  const active = new Set<Type>();
  return lowerTypeWorker(context, type, active);
}

function lowerTypeWorker(context: VerificationTypeLoweringContext, type: Type, active: Set<Type>): VerificationTypeLoweringResult {
  if (type.flags & TypeFlags.BooleanLike) return { sort: "Bool" };
  if (type.flags & TypeFlags.BigIntLike) return { sort: "Int" };
  if (type.flags & TypeFlags.NumberLike) {
    return context.numberModel ? { sort: "Real" } : { reason: 'TypeScript number requires numberModel: "mathematical-real".' };
  }
  if (type.flags & TypeFlags.StringLike) return { sort: "String" };
  if (active.has(type)) return { reason: `Recursive type '${context.checker.typeToString(type)}' is outside the supported verification subset.` };
  active.add(type);
  const result = type.flags & TypeFlags.Union
    ? lowerDiscriminatedUnion(context, type as UnionType, active)
    : type.flags & TypeFlags.Object
    ? lowerRecord(context, type, active)
    : { reason: `Type '${context.checker.typeToString(type)}' is outside the supported verification subset.` };
  active.delete(type);
  return result;
}

function lowerDiscriminatedUnion(context: VerificationTypeLoweringContext, type: UnionType, active: Set<Type>): VerificationTypeLoweringResult {
  const variants: VerificationSumSort["variants"][number][] = [];
  const variantNames = new Set<string>();
  for (const member of type.types) {
    const tag = getStringDiscriminant(context.checker, member);
    if (!tag) return { reason: `Union '${context.checker.typeToString(type)}' is not a closed union with a unique string '_tag' discriminant.` };
    if (variantNames.has(tag)) return { reason: `Union '${context.checker.typeToString(type)}' has duplicate '_tag' value '${tag}'.` };
    variantNames.add(tag);
    const fields = lowerProperties(context, member, active, /*omitTag*/ true);
    if (propertyLoweringFailed(fields)) return fields;
    variants.push({ name: tag, fields: fields.fields });
  }
  return { sort: { kind: "sum", name: context.checker.typeToString(type), variants } };
}

function lowerRecord(context: VerificationTypeLoweringContext, type: Type, active: Set<Type>): VerificationTypeLoweringResult {
  if (context.checker.getIndexInfosOfType(type).length) return { reason: `Indexed type '${context.checker.typeToString(type)}' is outside the supported verification subset.` };
  const fields = lowerProperties(context, type, active, /*omitTag*/ false);
  if (propertyLoweringFailed(fields)) return fields;
  const sort: VerificationProductSort = { kind: "product", name: context.checker.typeToString(type), fields: fields.fields };
  return { sort };
}

function lowerProperties(
  context: VerificationTypeLoweringContext,
  type: Type,
  active: Set<Type>,
  omitTag: boolean,
): { readonly fields: readonly VerificationField[]; } | { readonly reason: string; } {
  const fields: VerificationField[] = [];
  for (const property of context.checker.getPropertiesOfType(type)) {
    const name = String(property.escapedName);
    if (name.startsWith("__@nominal@") || omitTag && name === "_tag") continue;
    if (property.flags & SymbolFlags.Optional) return { reason: `Optional property '${name}' is outside the supported verification subset.` };
    const propertyType = context.checker.getTypeOfPropertyOfType(type, name);
    if (!propertyType) return { reason: `Property '${name}' has no type available for verification.` };
    const lowered = lowerTypeWorker(context, propertyType, active);
    if (verificationTypeLoweringFailed(lowered)) return { reason: `Property '${name}' cannot be lowered: ${lowered.reason}` };
    fields.push({ name, sort: lowered.sort });
  }
  return { fields };
}

function propertyLoweringFailed(
  result: { readonly fields: readonly VerificationField[]; } | { readonly reason: string; },
): result is { readonly reason: string; } {
  return hasProperty(result, "reason");
}

function getStringDiscriminant(checker: TypeChecker, type: Type): string | undefined {
  const tagType = checker.getTypeOfPropertyOfType(type, "_tag");
  return tagType && tagType.flags & TypeFlags.StringLiteral ? (tagType as Type & { readonly value: string; }).value : undefined;
}

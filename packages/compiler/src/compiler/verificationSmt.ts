import {
  VerificationExpression,
  VerificationField,
  VerificationProblem,
  VerificationProductSort,
  VerificationSort,
  verificationSortKey,
  VerificationSumSort,
} from "./verificationIR.js";

/**
 * The SMT-LIB backend for the solver-independent verification IR.
 *
 * @internal
 */
export interface VerificationSmtEncoding {
  readonly solverInput: string;
  readonly replayableSmtLib: string;
}

interface StructuredSortNames {
  readonly sort: string;
  readonly constructors: ReadonlyMap<string, string>;
  readonly selectors: ReadonlyMap<string, string>;
}

function hashText(text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function createStructuredSortNames(sort: VerificationProductSort | VerificationSumSort): StructuredSortNames {
  const hash = hashText(verificationSortKey(sort));
  const constructors = new Map<string, string>();
  const selectors = new Map<string, string>();
  if (sort.kind === "product") {
    constructors.set("", `|tspp.ctor.${hash}|`);
    for (const field of sort.fields) selectors.set(field.name, `|tspp.field.${hash}.${safeName(field.name)}|`);
  }
  else {
    for (const variant of sort.variants) {
      constructors.set(variant.name, `|tspp.ctor.${hash}.${safeName(variant.name)}|`);
      for (const field of variant.fields) selectors.set(`${variant.name}\0${field.name}`, `|tspp.field.${hash}.${safeName(variant.name)}.${safeName(field.name)}|`);
    }
  }
  return { sort: `|tspp.sort.${hash}|`, constructors, selectors };
}

function safeName(name: string): string {
  if (name.includes("|") || name.includes("\\") || name.includes("\0")) throw new Error(`Verification name '${name}' cannot be encoded as SMT-LIB.`);
  return name.replace(/\s+/g, "_");
}

function encodeSort(sort: VerificationSort, names: ReadonlyMap<string, StructuredSortNames>): string {
  if (typeof sort === "string") return sort;
  const result = names.get(verificationSortKey(sort));
  if (!result) throw new Error(`Structured verification sort '${sort.name}' was not declared.`);
  return result.sort;
}

function encodeVerificationExpression(expression: VerificationExpression, names: ReadonlyMap<string, StructuredSortNames>): string {
  switch (expression.kind) {
    case "constant":
      return expression.name;
    case "boolean":
      return expression.value ? "true" : "false";
    case "integer":
    case "real":
      return expression.value.startsWith("-") ? `(- ${expression.value.slice(1)})` : expression.value;
    case "string":
      return `"${expression.value.replace(/"/g, '""')}"`;
    case "construct": {
      const sortNames = names.get(verificationSortKey(expression.sort));
      const constructor = sortNames?.constructors.get(expression.variant ?? "");
      if (!constructor) throw new Error(`Unknown constructor '${expression.variant ?? expression.sort.name}'.`);
      const fields = expression.fields.map(field => encodeVerificationExpression(field, names));
      return fields.length ? `(${constructor} ${fields.join(" ")})` : constructor;
    }
    case "select": {
      const sortNames = names.get(verificationSortKey(expression.sort));
      const selector = sortNames?.selectors.get(expression.sort.kind === "sum" ? `${expression.variant ?? ""}\0${expression.field}` : expression.field);
      if (!selector) throw new Error(`Unknown field '${expression.field}' on verification sort '${expression.sort.name}'.`);
      return `(${selector} ${encodeVerificationExpression(expression.target, names)})`;
    }
    case "is-variant": {
      const sortNames = names.get(verificationSortKey(expression.sort));
      const constructor = sortNames?.constructors.get(expression.variant);
      if (!constructor) throw new Error(`Unknown variant '${expression.variant}' on verification sort '${expression.sort.name}'.`);
      return `((_ is ${constructor}) ${encodeVerificationExpression(expression.target, names)})`;
    }
    case "application":
      return `(${expression.operator} ${expression.operands.map(operand => encodeVerificationExpression(operand, names)).join(" ")})`;
  }
}

function collectStructuredSorts(problem: VerificationProblem): readonly (VerificationProductSort | VerificationSumSort)[] {
  const result = new Map<string, VerificationProductSort | VerificationSumSort>();
  const visiting = new Set<VerificationProductSort | VerificationSumSort>();
  const visit = (sort: VerificationSort): void => {
    if (typeof sort === "string") return;
    const key = verificationSortKey(sort);
    if (result.has(key)) return;
    if (visiting.has(sort)) return;
    visiting.add(sort);
    validateStructuredSort(sort);
    result.set(key, sort);
    const fields = sort.kind === "product" ? sort.fields : sort.variants.flatMap(variant => variant.fields);
    for (const field of fields) visit(field.sort);
    visiting.delete(sort);
  };
  for (const sort of problem.structuredSorts ?? []) visit(sort);
  for (const declaration of problem.declarations) visit(declaration.sort);
  const visitExpression = (expression: VerificationExpression): void => {
    switch (expression.kind) {
      case "constant":
        visit(expression.sort);
        break;
      case "construct":
        visit(expression.sort);
        for (const field of expression.fields) visitExpression(field);
        break;
      case "select":
      case "is-variant":
        visit(expression.sort);
        visitExpression(expression.target);
        break;
      case "application":
        for (const operand of expression.operands) visitExpression(operand);
        break;
      case "boolean":
      case "integer":
      case "real":
      case "string":
        break;
    }
  };
  for (const assumption of problem.assumptions) visitExpression(assumption);
  visitExpression(problem.goal);
  return [...result.values()];
}

function validateStructuredSort(sort: VerificationProductSort | VerificationSumSort): void {
  if (!sort.name) throw new Error("A structured verification sort must have a name.");
  if (sort.kind === "sum" && !sort.variants.length) throw new Error(`Sum verification sort '${sort.name}' must have at least one variant.`);
  const variantNames = new Set<string>();
  const variants = sort.kind === "product" ? [{ name: "", fields: sort.fields }] : sort.variants;
  for (const variant of variants) {
    if (variantNames.has(variant.name)) throw new Error(`Duplicate variant '${variant.name}' on verification sort '${sort.name}'.`);
    variantNames.add(variant.name);
    const fieldNames = new Set<string>();
    for (const field of variant.fields) {
      if (fieldNames.has(field.name)) throw new Error(`Duplicate field '${field.name}' on verification sort '${sort.name}'.`);
      fieldNames.add(field.name);
    }
  }
}

function encodeFields(fields: readonly VerificationField[], names: StructuredSortNames, variant: string | undefined, allNames: ReadonlyMap<string, StructuredSortNames>): string {
  return fields.map(field => {
    const selector = names.selectors.get(variant === undefined ? field.name : `${variant}\0${field.name}`)!;
    return `(${selector} ${encodeSort(field.sort, allNames)})`;
  }).join(" ");
}

function encodeStructuredSortConstructors(sort: VerificationProductSort | VerificationSumSort, allNames: ReadonlyMap<string, StructuredSortNames>): string {
  const names = allNames.get(verificationSortKey(sort))!;
  return sort.kind === "product"
    ? encodeConstructorDeclaration(names.constructors.get("")!, encodeFields(sort.fields, names, /*variant*/ undefined, allNames))
    : sort.variants.map(variant => encodeConstructorDeclaration(names.constructors.get(variant.name)!, encodeFields(variant.fields, names, variant.name, allNames))).join(" ");
}

function encodeConstructorDeclaration(constructor: string, fields: string): string {
  return fields ? `(${constructor} ${fields})` : `(${constructor})`;
}

export function encodeVerificationProblem(problem: VerificationProblem, timeout = 10_000): VerificationSmtEncoding {
  const structuredSorts = collectStructuredSorts(problem);
  const structuredSortNames = new Map(structuredSorts.map(sort => [verificationSortKey(sort), createStructuredSortNames(sort)]));
  const mapping = problem.declarations
    .filter(declaration => declaration.sourceName !== undefined)
    .map(declaration => `; ${declaration.name} = ${declaration.sourceName!.replace(/[\r\n]/g, " ")}`);
  const typeDeclarations = structuredSorts.length
    ? [encodeStructuredSortDeclarations(structuredSorts, structuredSortNames)]
    : [];
  const declarations = problem.declarations.map(declaration => `(declare-const ${declaration.name} ${encodeSort(declaration.sort, structuredSortNames)})`);
  const assertions = problem.assumptions.map(assumption => `(assert ${encodeVerificationExpression(assumption, structuredSortNames)})`);
  const solverInput = [
    "; Generated by TS++ verification backend",
    `; tspp-model ${JSON.stringify(createModelMetadata(problem, structuredSorts, structuredSortNames))}`,
    `(set-option :timeout ${timeout})`,
    `(set-logic ALL)`,
    ...mapping,
    ...typeDeclarations,
    ...declarations,
    ...assertions,
    `(assert (not ${encodeVerificationExpression(problem.goal, structuredSortNames)}))`,
  ].join("\n") + "\n";
  return {
    solverInput,
    replayableSmtLib: `${solverInput}(check-sat)\n(get-model)\n`,
  };
}

function encodeStructuredSortDeclarations(
  sorts: readonly (VerificationProductSort | VerificationSumSort)[],
  allNames: ReadonlyMap<string, StructuredSortNames>,
): string {
  const heads = sorts.map(sort => `(${allNames.get(verificationSortKey(sort))!.sort} 0)`).join(" ");
  const bodies = sorts.map(sort => `(${encodeStructuredSortConstructors(sort, allNames)})`).join(" ");
  return `(declare-datatypes (${heads}) (${bodies}))`;
}

function createModelMetadata(
  problem: VerificationProblem,
  structuredSorts: readonly (VerificationProductSort | VerificationSumSort)[],
  allNames: ReadonlyMap<string, StructuredSortNames>,
) {
  const sortName = (sort: VerificationSort) => typeof sort === "string" ? sort : allNames.get(verificationSortKey(sort))!.sort;
  return {
    declarations: problem.declarations.map(declaration => ({
      symbol: declaration.name,
      sourceName: declaration.sourceName ?? declaration.name,
      sort: sortName(declaration.sort),
    })),
    sorts: structuredSorts.map(sort => {
      const names = allNames.get(verificationSortKey(sort))!;
      const variants = sort.kind === "product"
        ? [{ name: undefined, fields: sort.fields }]
        : sort.variants;
      return {
        sort: names.sort,
        kind: sort.kind,
        name: sort.name,
        variants: variants.map(variant => ({
          name: variant.name,
          constructor: names.constructors.get(variant.name ?? "")!,
          fields: variant.fields.map(field => ({ name: field.name, sort: sortName(field.sort) })),
        })),
      };
    }),
  };
}

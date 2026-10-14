import {
  isBinaryExpression,
  isBlock,
  isBreakStatement,
  isCallExpression,
  isCaseClause,
  isDataVariant,
  isEmptyStatement,
  isExpressionStatement,
  isFunctionDeclaration,
  isIdentifier,
  isIfStatement,
  isNewtypeDeclaration,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPrefixUnaryExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isShorthandPropertyAssignment,
  isStringLiteral,
  isSwitchStatement,
  isTypeAliasDeclaration,
  isTypeReferenceNode,
  isVariableDeclaration,
  isVariableStatement,
  isWhileStatement,
} from "./factory/nodeTests.js";
import { forEachChild } from "./parser.js";
import {
  getStandardPredicateDefinition,
  type StandardPredicateDefinition,
  type StandardPredicateName,
} from "./standardPredicates.js";
import {
  Block,
  CallExpression,
  CancellationToken,
  DataVariant,
  Diagnostic,
  Expression,
  FunctionDeclaration,
  Identifier,
  NewtypeDeclaration,
  Node,
  ObjectLiteralExpression,
  Program,
  SourceFile,
  Statement,
  SwitchStatement,
  SymbolFlags,
  SyntaxKind,
  Type,
  TypeAliasDeclaration,
  TypeChecker,
  TypeFlags,
  TypeNode,
  VerificationArtifact,
  WhileStatement,
  WithClause,
} from "./types.js";
import {
  idText,
  isFunctionLike,
} from "./utilitiesPublic.js";
import {
  createVerificationConstant as freshConstant,
  createVerificationContext,
  VerificationContext,
} from "./verificationContext.js";
import {
  isVerificationNumericSort,
  verificationApplication,
  verificationBoolean,
  verificationConstruct,
  VerificationExpression,
  verificationInteger,
  verificationIsVariant,
  VerificationProblem,
  VerificationProductSort,
  verificationReal,
  verificationSelect,
  VerificationSort,
  verificationSortsEqual,
  verificationString,
  VerificationSumSort,
  VerificationTerm,
} from "./verificationIR.js";
import {
  cloneVerificationRefinementState,
  stopVerificationRefinement,
  VerificationFlowResult as FlowResult,
  VerificationRefinementState as SymbolicState,
  VerificationReturnPath as ReturnPath,
} from "./verificationRefinement.js";
import { encodeVerificationProblem } from "./verificationSmt.js";
import {
  createVerificationArtifact,
  createVerificationDiagnostic,
  PendingVerificationTask,
  updateVerificationArtifact,
} from "./verificationTasks.js";
import {
  lowerVerificationType,
  verificationTypeLoweringFailed,
} from "./verificationTypeLowering.js";
import { runVerificationQueries } from "./verificationWorker.js";

type Sort = VerificationSort;
type Term = VerificationTerm;

export interface FormalVerificationResult {
  readonly artifacts: readonly VerificationArtifact[];
  readonly diagnostics: readonly Diagnostic[];
}

const maximumPaths = 64;

export async function verifyFormalContracts(program: Program, cancellationToken?: CancellationToken): Promise<FormalVerificationResult> {
  cancellationToken?.throwIfCancellationRequested();
  const checker = program.getTypeChecker();
  const pending: PendingVerificationTask[] = [];
  for (const sourceFile of program.getSourceFiles()) {
    cancellationToken?.throwIfCancellationRequested();
    if (sourceFile.isDeclarationFile) continue;
    analyzeTopLevelCalls(checker, sourceFile, pending);
    visit(sourceFile, node => {
      cancellationToken?.throwIfCancellationRequested();
      if (!isFunctionDeclaration(node) || !node.body || !needsVerification(checker, node)) return;
      analyzeFunction(checker, sourceFile, node, pending);
    });
  }

  const queries = pending.filter(item => item.query !== undefined);
  if (queries.length) {
    const results = await runVerificationQueries(queries.map(item => item.query!), /*budget*/ undefined, cancellationToken);
    for (let i = 0; i < queries.length; i++) {
      const item = queries[i];
      const result = results[i];
      item.artifact = updateVerificationArtifact(item.artifact, {
        status: result.status,
        message: result.message,
        counterexample: result.counterexample,
        model: result.model,
        reason: result.reason,
      });
    }
  }

  const artifacts = pending.map(item => item.artifact);
  const diagnostics = artifacts
    .filter(artifact => artifact.status !== "proved")
    .map(artifact => createVerificationDiagnostic(program, artifact));
  return { artifacts, diagnostics };
}

function visit(root: Node, callback: (node: Node) => void): void {
  callback(root);
  forEachChild(root, child => {
    visit(child, callback);
    return undefined;
  });
}

function needsVerification(checker: TypeChecker, declaration: FunctionDeclaration): boolean {
  if (
    declaration.withClause?.properties.some(property => {
      const name = idText(property.name);
      return name === "requires" || name === "ensures";
    })
  ) return true;
  if (getRefinementTypeTarget(checker, declaration.type)) return true;
  let found = false;
  if (declaration.body) {
    visit(declaration.body, node => {
      if (isWhileStatement(node) && getProperties(node.withClause, "invariant").length) found = true;
      else if (isCallExpression(node) && getRefinementTarget(checker, node)) found = true;
      else if (isVariableDeclaration(node) && getRefinementTypeTarget(checker, node.type)) found = true;
      else if (isCallExpression(node) && getCallTarget(checker, node)?.withClause?.properties.some(property => idText(property.name) === "requires")) found = true;
    });
  }
  return found;
}

function analyzeTopLevelCalls(checker: TypeChecker, sourceFile: SourceFile, pending: PendingVerificationTask[]): void {
  const visitTopLevel = (node: Node): void => {
    if (node !== sourceFile && isFunctionLike(node)) return;
    if (isVariableDeclaration(node) && node.initializer) {
      const refinement = getRefinementTypeTarget(checker, node.type);
      if (refinement) {
        const context = createVerificationContext(checker, sourceFile, refinement, pending, getNumberModel(refinement.withClause));
        verifyRefinementValue(context, { values: new Map(), facts: [] }, node, refinement, node.initializer);
      }
    }
    if (isCallExpression(node)) {
      const refinement = getRefinementTarget(checker, node);
      if (refinement) {
        const context = createVerificationContext(checker, sourceFile, refinement, pending, getNumberModel(refinement.withClause));
        verifyRefinementIntroduction(context, { values: new Map(), facts: [] }, node, refinement);
      }
      const target = getCallTarget(checker, node);
      if (target && getProperties(target.withClause, "requires").length) {
        const context = createVerificationContext(checker, sourceFile, target, pending, getNumberModel(target.withClause));
        verifyCallPreconditions(context, { values: new Map(), facts: [] }, node, target, /*resultUsed*/ false);
      }
    }
    forEachChild(node, child => {
      visitTopLevel(child);
      return undefined;
    });
  };
  visitTopLevel(sourceFile);
}

function analyzeFunction(checker: TypeChecker, sourceFile: SourceFile, declaration: FunctionDeclaration, pending: PendingVerificationTask[]): void {
  const returnRefinement = getRefinementTypeTarget(checker, declaration.type);
  const context = createVerificationContext(checker, sourceFile, declaration, pending, getNumberModel(declaration.withClause) || getNumberModel(returnRefinement?.withClause));
  const initial: SymbolicState = { values: new Map(), facts: [] };
  for (const parameter of declaration.parameters) {
    if (!isIdentifier(parameter.name)) {
      initial.reason = "Destructured parameters are outside the supported verification subset.";
      continue;
    }
    const refinement = getRefinementTypeTarget(checker, parameter.type);
    const sort = refinement
      ? getSort({ ...context, numberModel: getNumberModel(refinement.withClause) }, refinement.type)
      : getSort(context, parameter.name);
    if (!sort) {
      initial.reason = unsupportedTypeMessage(context, parameter.name);
      continue;
    }
    const value = freshConstant(context, idText(parameter.name), sort);
    initial.values.set(idText(parameter.name), value);
    if (refinement) {
      const predicate = getProperties(refinement.withClause, "predicate")[0];
      const refinementContext: VerificationContext = {
        ...context,
        declaration: refinement,
        numberModel: getNumberModel(refinement.withClause),
      };
      const predicateState = cloneState(initial);
      predicateState.values.set("value", value);
      const assumption = predicate && translateExpression(refinementContext, predicateState, predicate.value);
      if (!assumption) initial.reason = `Refinement type '${idText(refinement.name)}' requires a predicate.`;
      else if (typeof assumption === "string") initial.reason = assumption;
      else if (assumption.sort !== "Bool") initial.reason = "A refinement predicate must have Boolean verification semantics.";
      else initial.facts.push(assumption.expression);
    }
  }
  for (const property of getProperties(declaration.withClause, "requires")) {
    const term = translateExpression(context, initial, property.value);
    if (typeof term === "string") initial.reason = term;
    else if (term.sort !== "Bool") initial.reason = "A requires expression must have Boolean SMT semantics.";
    else initial.facts.push(term.expression);
  }

  const ensures = getProperties(declaration.withClause, "ensures");
  if (initial.reason) {
    for (let ensureIndex = 0; ensureIndex < ensures.length; ensureIndex++) {
      addUnknown(context, ensures[ensureIndex], "function-contract", "postcondition", `${contractName(declaration)} postcondition ${ensureIndex + 1}`, initial.reason);
    }
    return;
  }
  const flow = executeBlock(context, declaration.body!, [initial]);
  if (returnRefinement) {
    for (const path of flow.returns) {
      if (path.state.reason || !path.value) {
        addUnknown(context, path.node, "refinement", "refinement-introduction", `${idText(returnRefinement.name)} refinement`, path.state.reason ?? "A refined return requires an explicit supported value.");
      }
      else {
        verifyRefinementTerm(context, path.state, path.node, returnRefinement, path.value);
      }
    }
  }
  if (ensures.length) {
    if (!flow.returns.length) {
      for (let ensureIndex = 0; ensureIndex < ensures.length; ensureIndex++) {
        addUnknown(context, ensures[ensureIndex], "function-contract", "postcondition", `${contractName(declaration)} postcondition ${ensureIndex + 1}`, "No explicit return path could be verified.");
      }
    }
    for (let pathIndex = 0; pathIndex < flow.returns.length; pathIndex++) {
      const path = flow.returns[pathIndex];
      for (let ensureIndex = 0; ensureIndex < ensures.length; ensureIndex++) {
        const property = ensures[ensureIndex];
        const name = `${contractName(declaration)} postcondition ${ensureIndex + 1}, return path ${pathIndex + 1}`;
        if (path.state.reason) {
          addUnknown(context, property, "function-contract", "postcondition", name, path.state.reason);
          continue;
        }
        const goal = translateExpression(context, path.state, property.value, path.value);
        if (typeof goal === "string") addUnknown(context, property, "function-contract", "postcondition", name, goal);
        else if (goal.sort !== "Bool") addUnknown(context, property, "function-contract", "postcondition", name, "An ensures expression must have Boolean SMT semantics.");
        else addQuery(context, property, "function-contract", "postcondition", name, path.state.facts, goal.expression);
      }
    }
  }
}

function executeBlock(context: VerificationContext, block: Block, input: SymbolicState[]): FlowResult {
  let live = input;
  const returns: ReturnPath[] = [];
  for (const statement of block.statements) {
    const next: SymbolicState[] = [];
    for (const state of live) {
      const result = executeStatement(context, statement, state);
      next.push(...result.live);
      returns.push(...result.returns);
      if (next.length + returns.length > maximumPaths) {
        const limited = next.slice(0, maximumPaths);
        for (const item of limited) item.reason = `Control flow exceeds the supported limit of ${maximumPaths} symbolic paths.`;
        return { live: limited, returns: returns.slice(0, maximumPaths) };
      }
    }
    live = next;
  }
  return { live, returns };
}

function executeStatement(context: VerificationContext, statement: Statement, state: SymbolicState): FlowResult {
  if (state.reason) return { live: [state], returns: [] };
  if (isBlock(statement)) return executeBlock(context, statement, [state]);
  if (isEmptyStatement(statement) || isFunctionDeclaration(statement)) return { live: [state], returns: [] };
  if (isVariableStatement(statement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (!isIdentifier(declaration.name)) return unsupportedFlow(state, "Destructured local declarations are outside the supported verification subset.");
      const name = idText(declaration.name);
      if (state.values.has(name)) return unsupportedFlow(state, `Shadowed local '${name}' is outside the supported verification subset.`);
      const refinement = getRefinementTypeTarget(context.checker, declaration.type);
      const sort = refinement
        ? getSort({ ...context, numberModel: getNumberModel(refinement.withClause) }, refinement.type)
        : getSort(context, declaration.name);
      if (!sort) return unsupportedFlow(state, unsupportedTypeMessage(context, declaration.name));
      if (declaration.initializer) {
        const value = translateExpression(context, state, declaration.initializer);
        if (typeof value === "string") return unsupportedFlow(state, value);
        if (!verificationSortsEqual(value.sort, sort)) return unsupportedFlow(state, `Initializer sort mismatch for '${name}'.`);
        if (refinement) verifyRefinementTerm(context, state, declaration, refinement, value);
        state.values.set(name, value);
      }
      else state.values.set(name, freshConstant(context, name, sort));
    }
    return { live: [state], returns: [] };
  }
  if (isExpressionStatement(statement)) {
    const reason = executeExpressionStatement(context, state, statement.expression);
    return reason ? unsupportedFlow(state, reason) : { live: [state], returns: [] };
  }
  if (isIfStatement(statement)) {
    const condition = translateExpression(context, state, statement.expression);
    if (typeof condition === "string") return unsupportedFlow(state, condition);
    if (condition.sort !== "Bool") return unsupportedFlow(state, "An if condition must have Boolean SMT semantics.");
    const thenState = cloneState(state);
    thenState.facts.push(condition.expression);
    const thenFlow = executeStatement(context, statement.thenStatement, thenState);
    const elseState = cloneState(state);
    elseState.facts.push(verificationApplication("not", condition.expression));
    const elseFlow = statement.elseStatement
      ? executeStatement(context, statement.elseStatement, elseState)
      : { live: [elseState], returns: [] };
    return { live: [...thenFlow.live, ...elseFlow.live], returns: [...thenFlow.returns, ...elseFlow.returns] };
  }
  if (isReturnStatement(statement)) {
    if (!statement.expression) return { live: [], returns: [{ state, node: statement }] };
    const value = translateExpression(context, state, statement.expression);
    if (typeof value === "string") state.reason = value;
    return { live: [], returns: [{ state, value: typeof value === "string" ? undefined : value, node: statement }] };
  }
  if (isWhileStatement(statement)) return executeWhile(context, statement, state);
  if (isSwitchStatement(statement)) return executeSwitch(context, statement, state);
  return unsupportedFlow(state, `Statement kind ${statement.kind} is outside the supported verification subset.`);
}

function executeSwitch(context: VerificationContext, statement: SwitchStatement, incoming: SymbolicState): FlowResult {
  let discriminant: Term | undefined;
  let variantTarget: Term | undefined;
  if (isPropertyAccessExpression(statement.expression) && idText(statement.expression.name) === "_tag") {
    const target = translateExpression(context, incoming, statement.expression.expression);
    if (typeof target === "string") return unsupportedFlow(incoming, target);
    if (typeof target.sort === "string" || target.sort.kind !== "sum") return unsupportedFlow(incoming, "A switch discriminant '_tag' requires a sum verification type.");
    variantTarget = target;
  }
  else {
    const translated = translateExpression(context, incoming, statement.expression);
    if (typeof translated === "string") return unsupportedFlow(incoming, translated);
    discriminant = translated;
  }
  const clauses = statement.caseBlock.clauses;
  const conditions = new Map<Node, VerificationExpression>();
  for (const clause of clauses) {
    if (!isCaseClause(clause)) continue;
    let condition: VerificationExpression;
    if (variantTarget) {
      if (!isStringLiteral(clause.expression)) return unsupportedFlow(incoming, "A switch over '_tag' requires string-literal cases.");
      const variantName = clause.expression.text;
      const sumSort = variantTarget.sort as VerificationSumSort;
      if (!sumSort.variants.some(variant => variant.name === variantName)) return unsupportedFlow(incoming, `Variant '${variantName}' does not belong to verification sort '${sumSort.name}'.`);
      condition = verificationIsVariant(variantTarget.expression, sumSort, variantName);
    }
    else {
      const caseValue = translateExpression(context, incoming, clause.expression);
      if (typeof caseValue === "string") return unsupportedFlow(incoming, caseValue);
      if (!verificationSortsEqual(discriminant!.sort, caseValue.sort)) return unsupportedFlow(incoming, "A switch case has an incompatible verification sort.");
      condition = verificationApplication("=", discriminant!.expression, caseValue.expression);
    }
    conditions.set(clause, condition);
  }
  const allConditions = [...conditions.values()];
  const precedingConditions: VerificationExpression[] = [];
  let fallthrough: SymbolicState[] = [];
  const exits: SymbolicState[] = [];
  const returns: ReturnPath[] = [];
  for (const clause of clauses) {
    let direct: SymbolicState;
    if (isCaseClause(clause)) {
      const condition = conditions.get(clause)!;
      direct = cloneState(incoming);
      direct.facts.push(...precedingConditions.map(previous => verificationApplication("not", previous)), condition);
      precedingConditions.push(condition);
    }
    else {
      direct = cloneState(incoming);
      direct.facts.push(...allConditions.map(condition => verificationApplication("not", condition)));
    }
    let live = [...fallthrough, direct];
    for (const clauseStatement of clause.statements) {
      if (isBreakStatement(clauseStatement)) {
        if (clauseStatement.label) return unsupportedFlow(incoming, "Labeled break is outside the supported verification subset.");
        exits.push(...live);
        live = [];
        break;
      }
      const next: SymbolicState[] = [];
      for (const state of live) {
        const result = executeStatement(context, clauseStatement, state);
        next.push(...result.live);
        returns.push(...result.returns);
      }
      live = next;
    }
    fallthrough = live;
  }
  const unmatched = clauses.some(clause => !isCaseClause(clause)) ? [] : [cloneState(incoming)];
  if (unmatched.length) unmatched[0].facts.push(...allConditions.map(condition => verificationApplication("not", condition)));
  return { live: [...exits, ...fallthrough, ...unmatched], returns };
}

function executeWhile(context: VerificationContext, statement: WhileStatement, incoming: SymbolicState): FlowResult {
  const invariants = getProperties(statement.withClause, "invariant");
  if (!invariants.length) return unsupportedFlow(incoming, "A while loop must declare at least one invariant to be verified.");
  const loopNumberModel = context.numberModel || getNumberModel(statement.withClause);
  if (loopNumberModel !== context.numberModel) {
    return unsupportedFlow(incoming, "A loop-level numberModel cannot introduce number semantics that are absent from its enclosing function in this version.");
  }
  const writes = new Set<string>();
  let writeReason: string | undefined;
  collectWrites(statement.statement, writes, reason => writeReason ??= reason);

  for (let i = 0; i < invariants.length; i++) {
    const property = invariants[i];
    const name = `${contractName(context.declaration)} loop invariant ${i + 1}`;
    if (incoming.reason) addUnknown(context, property, "loop-invariant", "invariant-initialization", `${name} initialization`, incoming.reason);
    else {
      const goal = translateExpression(context, incoming, property.value);
      if (typeof goal === "string") addUnknown(context, property, "loop-invariant", "invariant-initialization", `${name} initialization`, goal);
      else if (goal.sort !== "Bool") addUnknown(context, property, "loop-invariant", "invariant-initialization", `${name} initialization`, "An invariant must have Boolean SMT semantics.");
      else addQuery(context, property, "loop-invariant", "invariant-initialization", `${name} initialization`, incoming.facts, goal.expression);
    }
  }

  const head = cloneState(incoming);
  for (const name of writes) {
    const current = head.values.get(name);
    if (!current) writeReason ??= `Assignment to unknown variable '${name}' is unsupported.`;
    else head.values.set(name, freshConstant(context, name, current.sort));
  }
  const invariantTerms: VerificationExpression[] = [];
  for (const property of invariants) {
    const term = translateExpression(context, head, property.value);
    if (typeof term === "string") writeReason ??= term;
    else if (term.sort !== "Bool") writeReason ??= "An invariant must have Boolean SMT semantics.";
    else invariantTerms.push(term.expression);
  }
  const condition = translateExpression(context, head, statement.expression);
  if (typeof condition === "string") writeReason ??= condition;
  else if (condition.sort !== "Bool") writeReason ??= "A while condition must have Boolean SMT semantics.";

  if (writeReason) {
    for (let i = 0; i < invariants.length; i++) {
      addUnknown(context, invariants[i], "loop-invariant", "invariant-preservation", `${contractName(context.declaration)} loop invariant ${i + 1} preservation`, writeReason);
    }
    return unsupportedFlow(incoming, writeReason);
  }

  head.facts.push(...invariantTerms, (condition as Term).expression);
  const bodyFlow = executeStatement(context, statement.statement, head);
  if (bodyFlow.returns.length) {
    const reason = "return inside a verified loop is outside the supported verification subset.";
    for (let i = 0; i < invariants.length; i++) addUnknown(context, invariants[i], "loop-invariant", "invariant-preservation", `${contractName(context.declaration)} loop invariant ${i + 1} preservation`, reason);
    return unsupportedFlow(incoming, reason);
  }
  for (let i = 0; i < invariants.length; i++) {
    const property = invariants[i];
    const name = `${contractName(context.declaration)} loop invariant ${i + 1} preservation`;
    for (const state of bodyFlow.live) {
      if (state.reason) addUnknown(context, property, "loop-invariant", "invariant-preservation", name, state.reason);
      else {
        const goal = translateExpression(context, state, property.value);
        if (typeof goal === "string") addUnknown(context, property, "loop-invariant", "invariant-preservation", name, goal);
        else addQuery(context, property, "loop-invariant", "invariant-preservation", name, state.facts, goal.expression);
      }
    }
  }

  const after = cloneState(incoming);
  for (const name of writes) {
    const current = after.values.get(name)!;
    after.values.set(name, freshConstant(context, name, current.sort));
  }
  const afterInvariantTerms = invariants.map(property => translateExpression(context, after, property.value));
  const afterCondition = translateExpression(context, after, statement.expression);
  for (const term of afterInvariantTerms) {
    if (typeof term === "string") return unsupportedFlow(after, term);
    after.facts.push(term.expression);
  }
  if (typeof afterCondition === "string") return unsupportedFlow(after, afterCondition);
  after.facts.push(verificationApplication("not", afterCondition.expression));
  return { live: [after], returns: [] };
}

function executeExpressionStatement(context: VerificationContext, state: SymbolicState, expression: Expression): string | undefined {
  if (isCallExpression(expression)) {
    const result = translateCallExpression(context, state, expression, /*resultUsed*/ false);
    return typeof result === "string" ? result : undefined;
  }
  if (isBinaryExpression(expression) && isAssignmentOperator(expression.operatorToken.kind)) {
    if (!isIdentifier(expression.left)) return "Only assignments to identifiers are supported.";
    const name = idText(expression.left);
    const previous = state.values.get(name);
    if (!previous) return `Assignment to unknown variable '${name}' is unsupported.`;
    const right = translateExpression(context, state, expression.right);
    if (typeof right === "string") return right;
    if (!verificationSortsEqual(previous.sort, right.sort)) return `Assignment sort mismatch for '${name}'.`;
    const operator = expression.operatorToken.kind;
    if (operator === SyntaxKind.EqualsToken) state.values.set(name, right);
    else {
      const smtOperator = operator === SyntaxKind.PlusEqualsToken ? "+" : operator === SyntaxKind.MinusEqualsToken ? "-" : operator === SyntaxKind.AsteriskEqualsToken ? "*" : undefined;
      if (!smtOperator) return `Assignment operator kind ${expression.operatorToken.kind} is unsupported.`;
      state.values.set(name, { sort: previous.sort, expression: verificationApplication(smtOperator, previous.expression, right.expression) });
    }
    return undefined;
  }
  if (isPrefixUnaryExpression(expression) && (expression.operator === SyntaxKind.PlusPlusToken || expression.operator === SyntaxKind.MinusMinusToken) && isIdentifier(expression.operand)) {
    const name = idText(expression.operand);
    const previous = state.values.get(name);
    if (!previous || !isVerificationNumericSort(previous.sort)) return `Update of '${name}' is unsupported.`;
    state.values.set(name, { sort: previous.sort, expression: verificationApplication(expression.operator === SyntaxKind.PlusPlusToken ? "+" : "-", previous.expression, previous.sort === "Real" ? verificationReal("1") : verificationInteger("1")) });
    return undefined;
  }
  return `Expression statement '${sourceText(context, expression)}' is outside the supported verification subset.`;
}

function translateExpression(context: VerificationContext, state: SymbolicState, expression: Expression, result?: Term): Term | string {
  if (isParenthesizedExpression(expression)) return translateExpression(context, state, expression.expression, result);
  if (isCallExpression(expression)) return translateCallExpression(context, state, expression, /*resultUsed*/ true);
  if (isObjectLiteralExpression(expression)) return translateObjectLiteral(context, state, expression, result);
  if (isIdentifier(expression)) {
    const name = idText(expression);
    if (name === "result") return result ?? "The implicit 'result' value is only available on an explicit return path.";
    if (name === "true" || name === "false") return { sort: "Bool", expression: verificationBoolean(name === "true") };
    const variant = getDataVariantTarget(context.checker, expression);
    if (variant && !variant.parameters?.length) return translateDataVariant(context, state, variant, [], result);
    return state.values.get(name) ?? `Identifier '${name}' has no supported symbolic value.`;
  }
  if (expression.kind === SyntaxKind.TrueKeyword) return { sort: "Bool", expression: verificationBoolean(/*value*/ true) };
  if (expression.kind === SyntaxKind.FalseKeyword) return { sort: "Bool", expression: verificationBoolean(/*value*/ false) };
  if (expression.kind === SyntaxKind.BigIntLiteral) return { sort: "Int", expression: verificationInteger(sourceText(context, expression).replace(/n$/i, "")) };
  if (expression.kind === SyntaxKind.NumericLiteral) {
    if (!context.numberModel) return 'TypeScript number requires numberModel: "mathematical-real".';
    const text = sourceText(context, expression);
    if (!/^\d+(?:\.\d+)?$/.test(text)) return `Numeric literal '${text}' is outside the mathematical-real encoding subset.`;
    return { sort: "Real", expression: verificationReal(text) };
  }
  if (isStringLiteral(expression)) return { sort: "String", expression: verificationString(expression.text) };
  if (isPropertyAccessExpression(expression)) return translatePropertyAccess(context, state, expression, result);
  if (isPrefixUnaryExpression(expression)) {
    const operand = translateExpression(context, state, expression.operand, result);
    if (typeof operand === "string") return operand;
    if (expression.operator === SyntaxKind.ExclamationToken && operand.sort === "Bool") return { sort: "Bool", expression: verificationApplication("not", operand.expression) };
    if (expression.operator === SyntaxKind.MinusToken && isVerificationNumericSort(operand.sort)) return { sort: operand.sort, expression: verificationApplication("-", operand.expression) };
    return `Unary expression '${sourceText(context, expression)}' is outside the supported verification subset.`;
  }
  if (isBinaryExpression(expression)) {
    const variantCheck = translateVariantCheck(context, state, expression, result);
    if (variantCheck) return variantCheck;
    const left = translateExpression(context, state, expression.left, result);
    if (typeof left === "string") return left;
    const right = translateExpression(context, state, expression.right, result);
    if (typeof right === "string") return right;
    const kind = expression.operatorToken.kind;
    if (kind === SyntaxKind.AmpersandAmpersandToken || kind === SyntaxKind.BarBarToken) {
      if (left.sort !== "Bool" || right.sort !== "Bool") return "Logical operators require Boolean SMT operands.";
      return { sort: "Bool", expression: verificationApplication(kind === SyntaxKind.AmpersandAmpersandToken ? "and" : "or", left.expression, right.expression) };
    }
    if (!verificationSortsEqual(left.sort, right.sort)) return `Operands of operator kind ${expression.operatorToken.kind} have incompatible SMT sorts.`;
    if (kind === SyntaxKind.EqualsEqualsEqualsToken || kind === SyntaxKind.ExclamationEqualsEqualsToken) {
      const equality = verificationApplication("=", left.expression, right.expression);
      return { sort: "Bool", expression: kind === SyntaxKind.EqualsEqualsEqualsToken ? equality : verificationApplication("not", equality) };
    }
    const operator = binaryOperator(kind);
    if (!operator) return `Operator kind ${expression.operatorToken.kind} is outside the supported verification subset.`;
    if (!isVerificationNumericSort(left.sort)) return `Operator '${operator}' requires numeric SMT operands.`;
    const comparison = kind === SyntaxKind.LessThanToken || kind === SyntaxKind.LessThanEqualsToken || kind === SyntaxKind.GreaterThanToken || kind === SyntaxKind.GreaterThanEqualsToken;
    return { sort: comparison ? "Bool" : left.sort, expression: verificationApplication(operator, left.expression, right.expression) };
  }
  return `Expression '${sourceText(context, expression)}' is outside the supported verification subset.`;
}

function translateObjectLiteral(
  context: VerificationContext,
  state: SymbolicState,
  expression: ObjectLiteralExpression,
  result: Term | undefined,
): Term | string {
  const contextualType = context.checker.getContextualType(expression) ?? context.checker.getTypeAtLocation(expression);
  const lowered = lowerVerificationType(context, contextualType);
  if (verificationTypeLoweringFailed(lowered) || typeof lowered.sort === "string") {
    return verificationTypeLoweringFailed(lowered) ? lowered.reason : "An object literal requires a structured verification type.";
  }
  const values = new Map<string, Expression>();
  for (const property of expression.properties) {
    if (isPropertyAssignment(property)) {
      const name = propertyNameText(property.name);
      if (!name) return "Computed object-literal properties are outside the supported verification subset.";
      values.set(name, property.initializer);
    }
    else if (isShorthandPropertyAssignment(property)) values.set(idText(property.name), property.name);
    else return "Object-literal spreads, methods, and accessors are outside the supported verification subset.";
  }
  if (lowered.sort.kind === "product") return constructFromFields(context, state, lowered.sort, lowered.sort.fields, values, result);
  const tagExpression = values.get("_tag");
  if (!tagExpression || !isStringLiteral(tagExpression)) return `A '${lowered.sort.name}' object literal requires a string-literal '_tag'.`;
  const variant = lowered.sort.variants.find(candidate => candidate.name === tagExpression.text);
  if (!variant) return `Variant '${tagExpression.text}' does not belong to verification sort '${lowered.sort.name}'.`;
  values.delete("_tag");
  return constructFromFields(context, state, lowered.sort, variant.fields, values, result, variant.name);
}

function constructFromFields(
  context: VerificationContext,
  state: SymbolicState,
  sort: VerificationProductSort | VerificationSumSort,
  fields: readonly import("./verificationIR.js").VerificationField[],
  values: ReadonlyMap<string, Expression>,
  result: Term | undefined,
  variant?: string,
): Term | string {
  const terms: VerificationExpression[] = [];
  for (const field of fields) {
    const expression = values.get(field.name);
    if (!expression) return `Structured value '${sort.name}' is missing field '${field.name}'.`;
    const term = translateExpression(context, state, expression, result);
    if (typeof term === "string") return term;
    if (!verificationSortsEqual(term.sort, field.sort)) return `Field '${field.name}' has an incompatible verification sort.`;
    terms.push(term.expression);
  }
  return { sort, expression: verificationConstruct(sort, terms, variant) };
}

function propertyNameText(name: import("./types.js").PropertyName): string | undefined {
  return isIdentifier(name) || isStringLiteral(name) ? isIdentifier(name) ? idText(name) : name.text : undefined;
}

function translateVariantCheck(
  context: VerificationContext,
  state: SymbolicState,
  expression: import("./types.js").BinaryExpression,
  result: Term | undefined,
): Term | string | undefined {
  const kind = expression.operatorToken.kind;
  if (kind !== SyntaxKind.EqualsEqualsEqualsToken && kind !== SyntaxKind.ExclamationEqualsEqualsToken) return undefined;
  const left = getVariantCheckOperands(expression.left, expression.right);
  const operands = left ?? getVariantCheckOperands(expression.right, expression.left);
  if (!operands) return undefined;
  const target = translateExpression(context, state, operands.target, result);
  if (typeof target === "string") return target;
  if (typeof target.sort === "string" || target.sort.kind !== "sum") return undefined;
  if (!target.sort.variants.some(variant => variant.name === operands.variant)) {
    return `Variant '${operands.variant}' does not belong to verification sort '${target.sort.name}'.`;
  }
  const check = verificationIsVariant(target.expression, target.sort, operands.variant);
  return { sort: "Bool", expression: kind === SyntaxKind.EqualsEqualsEqualsToken ? check : verificationApplication("not", check) };
}

function getVariantCheckOperands(
  tag: Expression,
  value: Expression,
): { readonly target: Expression; readonly variant: string; } | undefined {
  return isPropertyAccessExpression(tag) && idText(tag.name) === "_tag" && isStringLiteral(value)
    ? { target: tag.expression, variant: value.text }
    : undefined;
}

function translatePropertyAccess(
  context: VerificationContext,
  state: SymbolicState,
  expression: import("./types.js").PropertyAccessExpression,
  result: Term | undefined,
): Term | string {
  const target = translateExpression(context, state, expression.expression, result);
  if (typeof target === "string") return target;
  if (typeof target.sort === "string") return `Property access '${sourceText(context, expression)}' requires a structured verification type.`;
  const fieldName = idText(expression.name);
  if (target.sort.kind === "product") {
    const field = target.sort.fields.find(candidate => candidate.name === fieldName);
    return field
      ? { sort: field.sort, expression: verificationSelect(target.expression, target.sort, fieldName) }
      : `Property '${fieldName}' does not belong to verification sort '${target.sort.name}'.`;
  }
  if (fieldName === "_tag") return "A discriminant value is only supported in a direct comparison with a string literal.";
  const narrowedType = context.checker.getTypeAtLocation(expression.expression);
  const variantName = getNarrowedVariantName(context.checker, narrowedType);
  if (!variantName) return `Property '${fieldName}' requires TypeScript control-flow narrowing to one '${target.sort.name}' variant.`;
  const variant = target.sort.variants.find(candidate => candidate.name === variantName);
  const field = variant?.fields.find(candidate => candidate.name === fieldName);
  return variant && field
    ? { sort: field.sort, expression: verificationSelect(target.expression, target.sort, fieldName, variant.name) }
    : `Property '${fieldName}' does not belong to variant '${variantName}'.`;
}

function getNarrowedVariantName(checker: TypeChecker, type: Type): string | undefined {
  const tag = checker.getTypeOfPropertyOfType(type, "_tag");
  return tag && tag.flags & TypeFlags.StringLiteral ? (tag as Type & { readonly value: string; }).value : undefined;
}

function translateCallExpression(context: VerificationContext, state: SymbolicState, expression: CallExpression, resultUsed: boolean): Term | string {
  const standardPredicate = getStandardPredicateName(expression);
  if (standardPredicate) return translateStandardPredicate(context, state, expression, standardPredicate);
  const refinement = getRefinementTarget(context.checker, expression);
  if (refinement) return verifyRefinementIntroduction(context, state, expression, refinement);
  const variant = isIdentifier(expression.expression) && getDataVariantTarget(context.checker, expression.expression);
  if (variant) return translateDataVariant(context, state, variant, expression.arguments, /*result*/ undefined);
  const target = getCallTarget(context.checker, expression);
  if (!target) return `Call '${sourceText(context, expression)}' does not resolve to a supported project function declaration.`;
  return verifyCallPreconditions(context, state, expression, target, resultUsed);
}

function getStandardPredicateName(expression: CallExpression): StandardPredicateName | undefined {
  if (!isIdentifier(expression.expression)) return undefined;
  return getStandardPredicateDefinition(idText(expression.expression))?.name;
}

function zeroForSort(sort: VerificationSort): VerificationExpression {
  return sort === "Real" ? verificationReal("0") : verificationInteger("0");
}

function integerExpression(term: Term): VerificationExpression {
  return term.sort === "Int" ? term.expression : verificationApplication("to_int", term.expression);
}

function constrainToInteger(term: Term, expression: VerificationExpression): VerificationExpression {
  return term.sort === "Int" ? expression : verificationApplication("and", verificationApplication("is_int", term.expression), expression);
}

function translateStandardPredicateForReal(
  name: StandardPredicateName,
  definition: StandardPredicateDefinition,
  argumentTerms: readonly Term[],
): Term | string {
  if (argumentTerms.some(argument => argument.sort !== "Real")) {
    return `Standard predicate '${name}' requires arguments of the same numeric type.`;
  }
  switch (definition.kind) {
    case "even":
    case "odd": {
      const value = argumentTerms[0];
      const parity = verificationApplication(
        "=",
        verificationApplication("mod", integerExpression(value), verificationInteger("2")),
        definition.kind === "even" ? verificationInteger("0") : verificationInteger("1"),
      );
      return {
        sort: "Bool",
        expression: constrainToInteger(value, parity),
      };
    }
    case "positive":
      return { sort: "Bool", expression: verificationApplication(">", argumentTerms[0].expression, zeroForSort(argumentTerms[0].sort)) };
    case "nonNegative":
      return { sort: "Bool", expression: verificationApplication(">=", argumentTerms[0].expression, zeroForSort(argumentTerms[0].sort)) };
    case "zero":
      return { sort: "Bool", expression: verificationApplication("=", argumentTerms[0].expression, zeroForSort(argumentTerms[0].sort)) };
    case "divides": {
      const [divisor, value] = argumentTerms;
      return {
        sort: "Bool",
        expression: verificationApplication(
          "and",
          verificationApplication("is_int", divisor.expression),
          verificationApplication("is_int", value.expression),
          verificationApplication("not", verificationApplication("=", divisor.expression, zeroForSort(divisor.sort))),
          verificationApplication(
            "=",
            verificationApplication("mod", integerExpression(value), integerExpression(divisor)),
            verificationInteger("0"),
          ),
        ),
      };
    }
    case "between":
      return {
        sort: "Bool",
        expression: verificationApplication(
          "and",
          verificationApplication(">=", argumentTerms[0].expression, argumentTerms[1].expression),
          verificationApplication("<=", argumentTerms[0].expression, argumentTerms[2].expression),
        ),
      };
    default:
      return `Unsupported standard predicate '${name}'.`;
  }
}

function translateStandardPredicate(
  context: VerificationContext,
  state: SymbolicState,
  expression: CallExpression,
  name: StandardPredicateName,
): Term | string {
  const definition = getStandardPredicateDefinition(name);
  if (!definition) return `Unknown standard predicate '${name}'.`;
  if (expression.arguments.length !== definition.arity) {
    return `Standard predicate '${name}' expects ${definition.arity} argument(s).`;
  }

  const argumentTerms: Term[] = [];
  for (const argument of expression.arguments) {
    const term = translateExpression(context, state, argument);
    if (typeof term === "string") return term;
    if (!isVerificationNumericSort(term.sort)) return `Standard predicate '${name}' requires bigint or number arguments.`;
    argumentTerms.push(term);
  }
  if (argumentTerms.some(term => term.sort === "Real")) {
    return translateStandardPredicateForReal(name, definition, argumentTerms);
  }

  switch (definition.kind) {
    case "even":
      return {
        sort: "Bool",
        expression: verificationApplication("=", verificationApplication("mod", argumentTerms[0].expression, verificationInteger("2")), verificationInteger("0")),
      };
    case "odd":
      return {
        sort: "Bool",
        expression: verificationApplication("=", verificationApplication("mod", argumentTerms[0].expression, verificationInteger("2")), verificationInteger("1")),
      };
    case "positive":
      return { sort: "Bool", expression: verificationApplication(">", argumentTerms[0].expression, verificationInteger("0")) };
    case "nonNegative":
      return { sort: "Bool", expression: verificationApplication(">=", argumentTerms[0].expression, verificationInteger("0")) };
    case "zero":
      return { sort: "Bool", expression: verificationApplication("=", argumentTerms[0].expression, verificationInteger("0")) };
    case "divides":
      return {
        sort: "Bool",
        expression: verificationApplication(
          "and",
          verificationApplication("not", verificationApplication("=", argumentTerms[0].expression, verificationInteger("0"))),
          verificationApplication("=", verificationApplication("mod", argumentTerms[1].expression, argumentTerms[0].expression), verificationInteger("0")),
        ),
      };
    case "between":
      return {
        sort: "Bool",
        expression: verificationApplication(
          "and",
          verificationApplication(">=", argumentTerms[0].expression, argumentTerms[1].expression),
          verificationApplication("<=", argumentTerms[0].expression, argumentTerms[2].expression),
        ),
      };
    default:
      return `Unsupported standard predicate '${name}'.`;
  }
}

function getDataVariantTarget(checker: TypeChecker, expression: Identifier): DataVariant | undefined {
  const symbol = checker.getSymbolAtLocation(expression);
  const target = symbol && symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  return target?.declarations?.find(isDataVariant);
}

function translateDataVariant(
  context: VerificationContext,
  state: SymbolicState,
  variantDeclaration: DataVariant,
  argumentExpressions: readonly Expression[],
  result: Term | undefined,
): Term | string {
  const lowered = lowerVerificationType(context, context.checker.getTypeAtLocation(variantDeclaration.parent.name));
  if (verificationTypeLoweringFailed(lowered) || typeof lowered.sort === "string" || lowered.sort.kind !== "sum") {
    return verificationTypeLoweringFailed(lowered) ? lowered.reason : `Data constructor '${idText(variantDeclaration.name)}' has no supported sum verification type.`;
  }
  const variant = lowered.sort.variants.find(candidate => candidate.name === idText(variantDeclaration.name));
  if (!variant || argumentExpressions.length !== variant.fields.length) return `Data constructor '${idText(variantDeclaration.name)}' has an unsupported argument list.`;
  const values = new Map(variant.fields.map((field, index) => [field.name, argumentExpressions[index]]));
  return constructFromFields(context, state, lowered.sort, variant.fields, values, result, variant.name);
}

function getRefinementTarget(checker: TypeChecker, expression: CallExpression): NewtypeDeclaration | undefined {
  if (!isIdentifier(expression.expression)) return undefined;
  const symbol = checker.getSymbolAtLocation(expression.expression);
  const target = symbol && symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  return target?.declarations?.find(isNewtypeDeclaration)?.withClause?.properties.some(property => idText(property.name) === "predicate")
    ? target.declarations.find(isNewtypeDeclaration)
    : undefined;
}

function getRefinementTypeTarget(checker: TypeChecker, type: TypeNode | undefined): TypeAliasDeclaration | undefined {
  if (!type || !isTypeReferenceNode(type) || !isIdentifier(type.typeName)) return undefined;
  const symbol = checker.getSymbolAtLocation(type.typeName);
  const target = symbol && symbol.flags & SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
  const declaration = target?.declarations?.find(isTypeAliasDeclaration);
  return declaration?.withClause?.properties.some(property => idText(property.name) === "predicate") ? declaration : undefined;
}

function verifyRefinementIntroduction(
  context: VerificationContext,
  callerState: SymbolicState,
  expression: CallExpression,
  target: NewtypeDeclaration,
): Term | string {
  const predicate = getProperties(target.withClause, "predicate")[0];
  const name = idText(target.name);
  if (!predicate || expression.arguments.length !== 1) {
    const reason = `Refinement constructor '${name}' requires exactly one argument and one predicate.`;
    addUnknown(context, expression, "refinement", "refinement-introduction", `${name} refinement`, reason);
    return reason;
  }
  const refinementContext: VerificationContext = {
    ...context,
    declaration: target,
    numberModel: getNumberModel(target.withClause),
  };
  const argument = translateExpression(refinementContext, callerState, expression.arguments[0]);
  if (typeof argument === "string") {
    addUnknown(refinementContext, expression, "refinement", "refinement-introduction", `${name} refinement`, argument);
    return argument;
  }
  verifyRefinementTerm(refinementContext, callerState, expression, target, argument);
  return argument;
}

function verifyRefinementValue(
  context: VerificationContext,
  state: SymbolicState,
  node: Node,
  target: TypeAliasDeclaration,
  expression: Expression,
): Term | string {
  const refinementContext: VerificationContext = {
    ...context,
    declaration: target,
    numberModel: getNumberModel(target.withClause),
  };
  const value = translateExpression(refinementContext, state, expression);
  if (typeof value === "string") {
    addUnknown(refinementContext, node, "refinement", "refinement-introduction", `${idText(target.name)} refinement`, value);
    return value;
  }
  verifyRefinementTerm(refinementContext, state, node, target, value);
  return value;
}

function verifyRefinementTerm(
  context: VerificationContext,
  callerState: SymbolicState,
  node: Node,
  target: NewtypeDeclaration | TypeAliasDeclaration,
  argument: Term,
): void {
  const predicate = getProperties(target.withClause, "predicate")[0];
  const name = idText(target.name);
  if (!predicate) {
    addUnknown(context, node, "refinement", "refinement-introduction", `${name} refinement`, `Refinement type '${name}' requires a predicate.`);
    return;
  }
  const refinementContext: VerificationContext = {
    ...context,
    declaration: target,
    numberModel: getNumberModel(target.withClause),
  };
  const expectedSort = getSort(refinementContext, target.type);
  if (!expectedSort || !verificationSortsEqual(expectedSort, argument.sort)) {
    addUnknown(refinementContext, node, "refinement", "refinement-introduction", `${name} refinement`, `Value introduced into refinement type '${name}' has an unsupported or incompatible verification sort.`);
    return;
  }
  const predicateState = cloneState(callerState);
  predicateState.values.set("value", argument);
  const goal = translateExpression(refinementContext, predicateState, predicate.value);
  if (typeof goal === "string") {
    addUnknown(refinementContext, node, "refinement", "refinement-introduction", `${name} refinement`, goal);
  }
  else if (goal.sort !== "Bool") {
    addUnknown(refinementContext, node, "refinement", "refinement-introduction", `${name} refinement`, "A refinement predicate must have Boolean verification semantics.");
  }
  else {
    addQuery(refinementContext, node, "refinement", "refinement-introduction", `${name} refinement`, predicateState.facts, goal.expression);
  }
}

function getCallTarget(checker: TypeChecker, expression: CallExpression): FunctionDeclaration | undefined {
  const declaration = checker.getResolvedSignature(expression)?.declaration;
  return declaration && isFunctionDeclaration(declaration) ? declaration : undefined;
}

function verifyCallPreconditions(
  context: VerificationContext,
  callerState: SymbolicState,
  expression: CallExpression,
  target: FunctionDeclaration,
  resultUsed: boolean,
): Term | string {
  const requires = getProperties(target.withClause, "requires");
  const targetName = contractName(target);
  const callContext: VerificationContext = {
    ...context,
    numberModel: context.numberModel || getNumberModel(target.withClause),
  };
  if (expression.arguments.length !== target.parameters.length || target.parameters.some(parameter => !isIdentifier(parameter.name))) {
    const reason = `Call to '${targetName}' uses parameters or arguments outside the supported direct-call subset.`;
    for (let i = 0; i < requires.length; i++) {
      addUnknown(callContext, expression, "call-precondition", "precondition", `${targetName} precondition ${i + 1}`, reason);
    }
    return reason;
  }

  const argumentTerms: Term[] = [];
  for (const argument of expression.arguments) {
    const term = translateExpression(callContext, callerState, argument);
    if (typeof term === "string") {
      for (let i = 0; i < requires.length; i++) {
        addUnknown(callContext, expression, "call-precondition", "precondition", `${targetName} precondition ${i + 1}`, term);
      }
      return term;
    }
    argumentTerms.push(term);
  }
  if (callerState.reason) {
    for (let i = 0; i < requires.length; i++) {
      addUnknown(callContext, expression, "call-precondition", "precondition", `${targetName} precondition ${i + 1}`, callerState.reason);
    }
    return callerState.reason;
  }

  const calleeState: SymbolicState = { values: new Map(), facts: [...callerState.facts] };
  for (let i = 0; i < target.parameters.length; i++) {
    const parameter = target.parameters[i];
    const parameterName = idText(parameter.name as Identifier);
    const parameterSort = getSort(callContext, parameter.name);
    const argument = argumentTerms[i];
    if (!parameterSort || !verificationSortsEqual(parameterSort, argument.sort)) {
      const reason = `Argument ${i + 1} of '${targetName}' has an unsupported or incompatible verification sort.`;
      for (let requirementIndex = 0; requirementIndex < requires.length; requirementIndex++) {
        addUnknown(callContext, expression, "call-precondition", "precondition", `${targetName} precondition ${requirementIndex + 1}`, reason);
      }
      return reason;
    }
    const parameterTerm = freshConstant(callContext, parameterName, parameterSort);
    calleeState.values.set(parameterName, parameterTerm);
    calleeState.facts.push(verificationApplication("=", parameterTerm.expression, argument.expression));
  }

  for (let i = 0; i < requires.length; i++) {
    const requirement = translateExpression(callContext, calleeState, requires[i].value);
    const name = `${targetName} precondition ${i + 1}`;
    if (typeof requirement === "string") addUnknown(callContext, expression, "call-precondition", "precondition", name, requirement);
    else if (requirement.sort !== "Bool") addUnknown(callContext, expression, "call-precondition", "precondition", name, "A requires expression must have Boolean SMT semantics.");
    else addQuery(callContext, expression, "call-precondition", "precondition", name, calleeState.facts, requirement.expression);
  }

  const returnSort = getSort(callContext, expression);
  if (!returnSort) return `Return type of '${targetName}' is outside the supported verification subset.`;
  if (resultUsed) {
    callerState.reason ??= `The result of call '${sourceText(context, expression)}' is outside the supported verification subset until callee ensures summaries are supported.`;
  }
  return freshConstant(callContext, `${targetName} result`, returnSort);
}

function binaryOperator(kind: SyntaxKind): "+" | "-" | "*" | "<" | "<=" | ">" | ">=" | undefined {
  switch (kind) {
    case SyntaxKind.PlusToken:
      return "+";
    case SyntaxKind.MinusToken:
      return "-";
    case SyntaxKind.AsteriskToken:
      return "*";
    case SyntaxKind.LessThanToken:
      return "<";
    case SyntaxKind.LessThanEqualsToken:
      return "<=";
    case SyntaxKind.GreaterThanToken:
      return ">";
    case SyntaxKind.GreaterThanEqualsToken:
      return ">=";
    default:
      return undefined;
  }
}

function isAssignmentOperator(kind: SyntaxKind): boolean {
  return kind === SyntaxKind.EqualsToken || kind === SyntaxKind.PlusEqualsToken || kind === SyntaxKind.MinusEqualsToken || kind === SyntaxKind.AsteriskEqualsToken;
}

function collectWrites(node: Node, writes: Set<string>, report: (reason: string) => void): void {
  if (isBinaryExpression(node) && isAssignmentOperator(node.operatorToken.kind)) {
    if (isIdentifier(node.left)) writes.add(idText(node.left));
    else report("Only assignments to identifiers are supported inside verified loops.");
  }
  else if (isPrefixUnaryExpression(node) && (node.operator === SyntaxKind.PlusPlusToken || node.operator === SyntaxKind.MinusMinusToken)) {
    if (isIdentifier(node.operand)) writes.add(idText(node.operand));
    else report("Only identifier updates are supported inside verified loops.");
  }
  if (isWhileStatement(node)) {
    report("Nested while loops are outside the supported verification subset.");
    return;
  }
  forEachChild(node, child => {
    collectWrites(child, writes, report);
    return undefined;
  });
}

function getSort(context: VerificationContext, node: Node): Sort | undefined {
  const lowered = lowerVerificationType(context, context.checker.getTypeAtLocation(node));
  return verificationTypeLoweringFailed(lowered) ? undefined : lowered.sort;
}

function unsupportedTypeMessage(context: VerificationContext, node: Node): string {
  const lowered = lowerVerificationType(context, context.checker.getTypeAtLocation(node));
  return verificationTypeLoweringFailed(lowered) ? lowered.reason : `Type '${context.checker.typeToString(context.checker.getTypeAtLocation(node))}' could not be lowered for verification.`;
}

function addQuery(
  context: VerificationContext,
  node: Node,
  kind: VerificationArtifact["kind"],
  obligation: VerificationArtifact["obligation"],
  name: string,
  facts: readonly VerificationExpression[],
  goal: VerificationExpression,
): void {
  const problem: VerificationProblem = {
    declarations: [...context.declarations].map(([symbol, sort]) => ({ name: symbol, sort, sourceName: context.symbolNames.get(symbol) })),
    assumptions: facts,
    goal,
  };
  const { solverInput, replayableSmtLib } = encodeVerificationProblem(problem);
  context.pending.push({
    query: solverInput,
    artifact: createVerificationArtifact(context.sourceFile, node, kind, obligation, name, "unknown", solverInput, replayableSmtLib, "Waiting for Z3."),
  });
}

function addUnknown(
  context: VerificationContext,
  node: Node,
  kind: VerificationArtifact["kind"],
  obligation: VerificationArtifact["obligation"],
  name: string,
  message: string,
): void {
  const text = `; No SMT query was executed.\n; Unsupported: ${message.replace(/[\r\n]/g, " ")}\n`;
  context.pending.push({
    artifact: createVerificationArtifact(
      context.sourceFile,
      node,
      kind,
      obligation,
      name,
      "unknown",
      text,
      text,
      message,
      { code: "unsupported", message },
    ),
  });
}

function getProperties(clause: WithClause | undefined, name: string) {
  return clause?.properties.filter(property => idText(property.name) === name) ?? [];
}

function getNumberModel(clause: WithClause | undefined): boolean {
  return clause?.properties.some(property => idText(property.name) === "numberModel" && isStringLiteral(property.value) && property.value.text === "mathematical-real") === true;
}

function contractName(declaration: FunctionDeclaration | NewtypeDeclaration | TypeAliasDeclaration): string {
  return declaration.name ? idText(declaration.name) : "anonymous function";
}

function sourceText(context: VerificationContext, node: Node): string {
  return context.sourceFile.text.slice(node.pos, node.end).trim();
}

function cloneState(state: SymbolicState): SymbolicState {
  return cloneVerificationRefinementState(state);
}

function unsupportedFlow(state: SymbolicState, reason: string): FlowResult {
  return stopVerificationRefinement(state, reason);
}

import {
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isEmptyStatement,
  isExpressionStatement,
  isFunctionDeclaration,
  isIdentifier,
  isIfStatement,
  isParenthesizedExpression,
  isPrefixUnaryExpression,
  isReturnStatement,
  isStringLiteral,
  isVariableStatement,
  isWhileStatement,
} from "./factory/nodeTests.js";
import { forEachChild } from "./parser.js";
import { skipTrivia } from "./scanner.js";
import {
  Block,
  CallExpression,
  Diagnostic,
  DiagnosticCategory,
  Expression,
  FunctionDeclaration,
  Identifier,
  Node,
  Program,
  SourceFile,
  Statement,
  SyntaxKind,
  TypeChecker,
  TypeFlags,
  VerificationArtifact,
  WhileStatement,
  WithClause,
  WithProperty,
} from "./types.js";
import {
  idText,
  isFunctionLike,
} from "./utilitiesPublic.js";

type Sort = "Bool" | "Int" | "Real";
interface Term {
  readonly text: string;
  readonly sort: Sort;
}
interface SymbolicState {
  readonly values: Map<string, Term>;
  readonly facts: string[];
  reason?: string;
}
interface ReturnPath {
  readonly state: SymbolicState;
  readonly value?: Term;
  readonly node: Node;
}
interface FlowResult {
  readonly live: SymbolicState[];
  readonly returns: ReturnPath[];
}
interface PendingArtifact {
  artifact: VerificationArtifact;
  query?: string;
}
interface VerificationContext {
  readonly checker: TypeChecker;
  readonly sourceFile: SourceFile;
  readonly declaration: FunctionDeclaration;
  readonly declarations: Map<string, Sort>;
  readonly symbolNames: Map<string, string>;
  readonly pending: PendingArtifact[];
  readonly numberModel: boolean;
  freshIndex: number;
}

export interface FormalVerificationResult {
  readonly artifacts: readonly VerificationArtifact[];
  readonly diagnostics: readonly Diagnostic[];
}

const verificationDiagnosticCode = 18090;
const maximumPaths = 64;

export async function verifyFormalContracts(program: Program): Promise<FormalVerificationResult> {
  const checker = program.getTypeChecker();
  const pending: PendingArtifact[] = [];
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    analyzeTopLevelCalls(checker, sourceFile, pending);
    visit(sourceFile, node => {
      if (!isFunctionDeclaration(node) || !node.body || !needsVerification(checker, node)) return;
      analyzeFunction(checker, sourceFile, node, pending);
    });
  }

  const queries = pending.filter(item => item.query !== undefined);
  if (queries.length) {
    const results = await runZ3(queries.map(item => item.query!));
    for (let i = 0; i < queries.length; i++) {
      const item = queries[i];
      const result = results[i];
      item.artifact = {
        ...item.artifact,
        status: result.status,
        message: result.message,
        counterexample: result.counterexample,
        model: result.model,
      };
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
  let found = false;
  if (declaration.body) {
    visit(declaration.body, node => {
      if (isWhileStatement(node) && getProperties(node.withClause, "invariant").length) found = true;
      else if (isCallExpression(node) && getCallTarget(checker, node)?.withClause?.properties.some(property => idText(property.name) === "requires")) found = true;
    });
  }
  return found;
}

function analyzeTopLevelCalls(checker: TypeChecker, sourceFile: SourceFile, pending: PendingArtifact[]): void {
  const visitTopLevel = (node: Node): void => {
    if (node !== sourceFile && isFunctionLike(node)) return;
    if (isCallExpression(node)) {
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

function createVerificationContext(
  checker: TypeChecker,
  sourceFile: SourceFile,
  declaration: FunctionDeclaration,
  pending: PendingArtifact[],
  numberModel: boolean,
): VerificationContext {
  return {
    checker,
    sourceFile,
    declaration,
    declarations: new Map(),
    symbolNames: new Map(),
    pending,
    numberModel,
    freshIndex: 0,
  };
}

function analyzeFunction(checker: TypeChecker, sourceFile: SourceFile, declaration: FunctionDeclaration, pending: PendingArtifact[]): void {
  const context = createVerificationContext(checker, sourceFile, declaration, pending, getNumberModel(declaration.withClause));
  const initial: SymbolicState = { values: new Map(), facts: [] };
  for (const parameter of declaration.parameters) {
    if (!isIdentifier(parameter.name)) {
      initial.reason = "Destructured parameters are outside the supported verification subset.";
      continue;
    }
    const sort = getSort(context, parameter.name);
    if (!sort) {
      initial.reason = unsupportedTypeMessage(context, parameter.name);
      continue;
    }
    initial.values.set(idText(parameter.name), freshConstant(context, idText(parameter.name), sort));
  }
  for (const property of getProperties(declaration.withClause, "requires")) {
    const term = translateExpression(context, initial, property.value);
    if (typeof term === "string") initial.reason = term;
    else if (term.sort !== "Bool") initial.reason = "A requires expression must have Boolean SMT semantics.";
    else initial.facts.push(term.text);
  }

  const ensures = getProperties(declaration.withClause, "ensures");
  if (initial.reason) {
    for (let ensureIndex = 0; ensureIndex < ensures.length; ensureIndex++) {
      addUnknown(context, ensures[ensureIndex], "function-contract", "postcondition", `${contractName(declaration)} postcondition ${ensureIndex + 1}`, initial.reason);
    }
    return;
  }
  const flow = executeBlock(context, declaration.body!, [initial]);
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
        else addQuery(context, property, "function-contract", "postcondition", name, path.state.facts, goal.text);
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
      const sort = getSort(context, declaration.name);
      if (!sort) return unsupportedFlow(state, unsupportedTypeMessage(context, declaration.name));
      if (declaration.initializer) {
        const value = translateExpression(context, state, declaration.initializer);
        if (typeof value === "string") return unsupportedFlow(state, value);
        if (value.sort !== sort) return unsupportedFlow(state, `Initializer sort mismatch for '${name}'.`);
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
    thenState.facts.push(condition.text);
    const thenFlow = executeStatement(context, statement.thenStatement, thenState);
    const elseState = cloneState(state);
    elseState.facts.push(`(not ${condition.text})`);
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
  return unsupportedFlow(state, `Statement kind ${statement.kind} is outside the supported verification subset.`);
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
      else addQuery(context, property, "loop-invariant", "invariant-initialization", `${name} initialization`, incoming.facts, goal.text);
    }
  }

  const head = cloneState(incoming);
  for (const name of writes) {
    const current = head.values.get(name);
    if (!current) writeReason ??= `Assignment to unknown variable '${name}' is unsupported.`;
    else head.values.set(name, freshConstant(context, name, current.sort));
  }
  const invariantTerms: string[] = [];
  for (const property of invariants) {
    const term = translateExpression(context, head, property.value);
    if (typeof term === "string") writeReason ??= term;
    else if (term.sort !== "Bool") writeReason ??= "An invariant must have Boolean SMT semantics.";
    else invariantTerms.push(term.text);
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

  head.facts.push(...invariantTerms, (condition as Term).text);
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
        else addQuery(context, property, "loop-invariant", "invariant-preservation", name, state.facts, goal.text);
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
    after.facts.push(term.text);
  }
  if (typeof afterCondition === "string") return unsupportedFlow(after, afterCondition);
  after.facts.push(`(not ${afterCondition.text})`);
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
    if (previous.sort !== right.sort) return `Assignment sort mismatch for '${name}'.`;
    const operator = expression.operatorToken.kind;
    if (operator === SyntaxKind.EqualsToken) state.values.set(name, right);
    else {
      const smtOperator = operator === SyntaxKind.PlusEqualsToken ? "+" : operator === SyntaxKind.MinusEqualsToken ? "-" : operator === SyntaxKind.AsteriskEqualsToken ? "*" : undefined;
      if (!smtOperator) return `Assignment operator kind ${expression.operatorToken.kind} is unsupported.`;
      state.values.set(name, { sort: previous.sort, text: `(${smtOperator} ${previous.text} ${right.text})` });
    }
    return undefined;
  }
  if (isPrefixUnaryExpression(expression) && (expression.operator === SyntaxKind.PlusPlusToken || expression.operator === SyntaxKind.MinusMinusToken) && isIdentifier(expression.operand)) {
    const name = idText(expression.operand);
    const previous = state.values.get(name);
    if (!previous || previous.sort === "Bool") return `Update of '${name}' is unsupported.`;
    state.values.set(name, { sort: previous.sort, text: `(${expression.operator === SyntaxKind.PlusPlusToken ? "+" : "-"} ${previous.text} 1)` });
    return undefined;
  }
  return `Expression statement '${sourceText(context, expression)}' is outside the supported verification subset.`;
}

function translateExpression(context: VerificationContext, state: SymbolicState, expression: Expression, result?: Term): Term | string {
  if (isParenthesizedExpression(expression)) return translateExpression(context, state, expression.expression, result);
  if (isCallExpression(expression)) return translateCallExpression(context, state, expression, /*resultUsed*/ true);
  if (isIdentifier(expression)) {
    const name = idText(expression);
    if (name === "result") return result ?? "The implicit 'result' value is only available on an explicit return path.";
    if (name === "true" || name === "false") return { sort: "Bool", text: name };
    return state.values.get(name) ?? `Identifier '${name}' has no supported symbolic value.`;
  }
  if (expression.kind === SyntaxKind.TrueKeyword) return { sort: "Bool", text: "true" };
  if (expression.kind === SyntaxKind.FalseKeyword) return { sort: "Bool", text: "false" };
  if (expression.kind === SyntaxKind.BigIntLiteral) return { sort: "Int", text: sourceText(context, expression).replace(/n$/i, "") };
  if (expression.kind === SyntaxKind.NumericLiteral) {
    if (!context.numberModel) return 'TypeScript number requires numberModel: "mathematical-real".';
    const text = sourceText(context, expression);
    if (!/^\d+(?:\.\d+)?$/.test(text)) return `Numeric literal '${text}' is outside the mathematical-real encoding subset.`;
    return { sort: "Real", text };
  }
  if (isPrefixUnaryExpression(expression)) {
    const operand = translateExpression(context, state, expression.operand, result);
    if (typeof operand === "string") return operand;
    if (expression.operator === SyntaxKind.ExclamationToken && operand.sort === "Bool") return { sort: "Bool", text: `(not ${operand.text})` };
    if (expression.operator === SyntaxKind.MinusToken && operand.sort !== "Bool") return { sort: operand.sort, text: `(- ${operand.text})` };
    return `Unary expression '${sourceText(context, expression)}' is outside the supported verification subset.`;
  }
  if (isBinaryExpression(expression)) {
    const left = translateExpression(context, state, expression.left, result);
    if (typeof left === "string") return left;
    const right = translateExpression(context, state, expression.right, result);
    if (typeof right === "string") return right;
    const kind = expression.operatorToken.kind;
    if (kind === SyntaxKind.AmpersandAmpersandToken || kind === SyntaxKind.BarBarToken) {
      if (left.sort !== "Bool" || right.sort !== "Bool") return "Logical operators require Boolean SMT operands.";
      return { sort: "Bool", text: `(${kind === SyntaxKind.AmpersandAmpersandToken ? "and" : "or"} ${left.text} ${right.text})` };
    }
    if (left.sort !== right.sort) return `Operands of operator kind ${expression.operatorToken.kind} have incompatible SMT sorts.`;
    if (kind === SyntaxKind.EqualsEqualsEqualsToken || kind === SyntaxKind.ExclamationEqualsEqualsToken) {
      const equality = `(= ${left.text} ${right.text})`;
      return { sort: "Bool", text: kind === SyntaxKind.EqualsEqualsEqualsToken ? equality : `(not ${equality})` };
    }
    const operator = binaryOperator(kind);
    if (!operator) return `Operator kind ${expression.operatorToken.kind} is outside the supported verification subset.`;
    if (left.sort === "Bool") return `Operator '${operator}' does not accept Boolean SMT operands.`;
    const comparison = kind === SyntaxKind.LessThanToken || kind === SyntaxKind.LessThanEqualsToken || kind === SyntaxKind.GreaterThanToken || kind === SyntaxKind.GreaterThanEqualsToken;
    return { sort: comparison ? "Bool" : left.sort, text: `(${operator} ${left.text} ${right.text})` };
  }
  return `Expression '${sourceText(context, expression)}' is outside the supported verification subset.`;
}

function translateCallExpression(context: VerificationContext, state: SymbolicState, expression: CallExpression, resultUsed: boolean): Term | string {
  const target = getCallTarget(context.checker, expression);
  if (!target) return `Call '${sourceText(context, expression)}' does not resolve to a supported project function declaration.`;
  return verifyCallPreconditions(context, state, expression, target, resultUsed);
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

  const arguments_: Term[] = [];
  for (const argument of expression.arguments) {
    const term = translateExpression(callContext, callerState, argument);
    if (typeof term === "string") {
      for (let i = 0; i < requires.length; i++) {
        addUnknown(callContext, expression, "call-precondition", "precondition", `${targetName} precondition ${i + 1}`, term);
      }
      return term;
    }
    arguments_.push(term);
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
    const argument = arguments_[i];
    if (!parameterSort || parameterSort !== argument.sort) {
      const reason = `Argument ${i + 1} of '${targetName}' has an unsupported or incompatible verification sort.`;
      for (let requirementIndex = 0; requirementIndex < requires.length; requirementIndex++) {
        addUnknown(callContext, expression, "call-precondition", "precondition", `${targetName} precondition ${requirementIndex + 1}`, reason);
      }
      return reason;
    }
    const parameterTerm = freshConstant(callContext, parameterName, parameterSort);
    calleeState.values.set(parameterName, parameterTerm);
    calleeState.facts.push(`(= ${parameterTerm.text} ${argument.text})`);
  }

  for (let i = 0; i < requires.length; i++) {
    const requirement = translateExpression(callContext, calleeState, requires[i].value);
    const name = `${targetName} precondition ${i + 1}`;
    if (typeof requirement === "string") addUnknown(callContext, expression, "call-precondition", "precondition", name, requirement);
    else if (requirement.sort !== "Bool") addUnknown(callContext, expression, "call-precondition", "precondition", name, "A requires expression must have Boolean SMT semantics.");
    else addQuery(callContext, expression, "call-precondition", "precondition", name, calleeState.facts, requirement.text);
  }

  const returnSort = getSort(callContext, expression);
  if (!returnSort) return `Return type of '${targetName}' is outside the supported verification subset.`;
  if (resultUsed) {
    callerState.reason ??= `The result of call '${sourceText(context, expression)}' is outside the supported verification subset until callee ensures summaries are supported.`;
  }
  return freshConstant(callContext, `${targetName} result`, returnSort);
}

function binaryOperator(kind: SyntaxKind): string | undefined {
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
  const flags = context.checker.getTypeAtLocation(node).flags;
  if (flags & TypeFlags.BooleanLike) return "Bool";
  if (flags & TypeFlags.BigIntLike) return "Int";
  if (flags & TypeFlags.NumberLike && context.numberModel) return "Real";
  return undefined;
}

function unsupportedTypeMessage(context: VerificationContext, node: Node): string {
  const type = context.checker.typeToString(context.checker.getTypeAtLocation(node));
  return type === "number"
    ? 'TypeScript number requires numberModel: "mathematical-real".'
    : `Type '${type}' is outside the supported verification subset (boolean, bigint, and opted-in mathematical-real number).`;
}

function freshConstant(context: VerificationContext, sourceName: string, sort: Sort): Term {
  let smtName: string;
  do smtName = `v${context.freshIndex++}`;
  while (context.declarations.has(smtName));
  context.declarations.set(smtName, sort);
  context.symbolNames.set(smtName, sourceName);
  return { text: smtName, sort };
}

function addQuery(
  context: VerificationContext,
  node: Node,
  kind: VerificationArtifact["kind"],
  obligation: VerificationArtifact["obligation"],
  name: string,
  facts: readonly string[],
  goal: string,
): void {
  const declarations = [...context.declarations].map(([symbol, sort]) => `(declare-const ${symbol} ${sort})`);
  const mapping = [...context.symbolNames].map(([symbol, source]) => `; ${symbol} = ${source.replace(/[\r\n]/g, " ")}`);
  const assertions = facts.map(fact => `(assert ${fact})`);
  const solverInput = [
    "; Generated by TS++ formalContracts",
    `(set-option :timeout 10000)`,
    `(set-logic ALL)`,
    ...mapping,
    ...declarations,
    ...assertions,
    `(assert (not ${goal}))`,
  ].join("\n") + "\n";
  const replayableSmtLib = `${solverInput}(check-sat)\n(get-model)\n`;
  context.pending.push({
    query: solverInput,
    artifact: createArtifact(context.sourceFile, node, kind, obligation, name, "unknown", solverInput, replayableSmtLib, "Waiting for Z3."),
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
  context.pending.push({ artifact: createArtifact(context.sourceFile, node, kind, obligation, name, "unknown", text, text, message) });
}

function createArtifact(
  sourceFile: SourceFile,
  node: Node,
  kind: VerificationArtifact["kind"],
  obligation: VerificationArtifact["obligation"],
  name: string,
  status: VerificationArtifact["status"],
  solverInput: string,
  replayableSmtLib: string,
  message: string,
): VerificationArtifact {
  const target = node.kind === SyntaxKind.WithProperty ? (node as WithProperty).value : node;
  const start = skipTrivia(sourceFile.text, target.pos);
  return { fileName: sourceFile.fileName, start, length: target.end - start, kind, obligation, name, status, solverInput, replayableSmtLib, message };
}

function createVerificationDiagnostic(program: Program, artifact: VerificationArtifact): Diagnostic {
  const file = program.getSourceFile(artifact.fileName);
  return {
    category: DiagnosticCategory.Error,
    code: verificationDiagnosticCode,
    file,
    start: artifact.start,
    length: artifact.length,
    source: "TS++ verification",
    messageText: formatVerificationMessage(artifact),
  };
}

export function formatVerificationMessage(artifact: VerificationArtifact): string {
  const summary = `${artifact.name}: ${artifact.status === "failed" ? "proof failed" : "verification unknown"}. ${artifact.message}`;
  return artifact.counterexample ? `${summary} Counterexample: ${artifact.counterexample}.` : summary;
}

function getProperties(clause: WithClause | undefined, name: string) {
  return clause?.properties.filter(property => idText(property.name) === name) ?? [];
}

function getNumberModel(clause: WithClause | undefined): boolean {
  return clause?.properties.some(property => idText(property.name) === "numberModel" && isStringLiteral(property.value) && property.value.text === "mathematical-real") === true;
}

function contractName(declaration: FunctionDeclaration): string {
  return declaration.name ? idText(declaration.name) : "anonymous function";
}

function sourceText(context: VerificationContext, node: Node): string {
  return context.sourceFile.text.slice(node.pos, node.end).trim();
}

function cloneState(state: SymbolicState): SymbolicState {
  return { values: new Map(state.values), facts: [...state.facts], reason: state.reason };
}

function unsupportedFlow(state: SymbolicState, reason: string): FlowResult {
  state.reason = reason;
  return { live: [state], returns: [] };
}

interface SolverResult {
  readonly status: "proved" | "failed" | "unknown" | "error";
  readonly message: string;
  readonly counterexample?: string;
  readonly model?: string;
}

async function runZ3(inputs: readonly string[]): Promise<readonly SolverResult[]> {
  try {
    if (typeof require !== "function") return inputs.map(() => unavailableResult("Z3 is unavailable in this runtime."));
    const { Worker } = require("node:worker_threads") as typeof import("node:worker_threads");
    const z3Path = require.resolve("z3-solver");
    return await new Promise<readonly SolverResult[]>((resolve, reject) => {
      const worker = new Worker(z3WorkerScript, { eval: true, workerData: { inputs, z3Path } });
      const timer = globalThis.setTimeout(() => {
        void worker.terminate();
        reject(new Error("Z3 verification worker timed out."));
      }, Math.max(30_000, inputs.length * 12_000));
      worker.once("message", (message: { ok: boolean; results?: SolverResult[]; error?: string; }) => {
        globalThis.clearTimeout(timer);
        void worker.terminate();
        if (message.ok && message.results) resolve(message.results);
        else reject(new Error(message.error ?? "Z3 verification worker failed."));
      });
      worker.once("error", error => {
        globalThis.clearTimeout(timer);
        void worker.terminate();
        reject(error);
      });
    });
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return inputs.map(() => unavailableResult(`Z3 could not run: ${message}`));
  }
}

function unavailableResult(message: string): SolverResult {
  return { status: "unknown", message };
}

const z3WorkerScript = String.raw`
const { parentPort, workerData } = require("node:worker_threads");

async function run() {
  const z3 = require(workerData.z3Path);
  const api = await z3.init();
  const context = new api.Context("tspp-verification");
  const results = [];
  for (const input of workerData.inputs) {
    try {
      const solver = new context.Solver();
      solver.fromString(input);
      const answer = await solver.check();
      if (answer === "unsat") results.push({ status: "proved", message: "Z3 proved the negated obligation unsatisfiable." });
      else if (answer === "sat") {
        const modelObject = solver.model();
        const model = modelObject.toString();
        const declarations = [...input.matchAll(/\(declare-const\s+([^\s()]+)\s+(Int|Real|Bool)\)/g)];
        const sourceNames = new Map([...input.matchAll(/^;\s*([^\s=]+)\s*=\s*(.+)$/gm)].map(match => [match[1], match[2].trim()]));
        const modeledNames = new Set([...model.matchAll(/\(define-fun\s+([^\s()]+)/g)].map(match => match[1]));
        const selected = modeledNames.size ? declarations.filter(match => modeledNames.has(match[1])) : declarations;
        const duplicateSourceNames = new Set();
        const seenSourceNames = new Set();
        for (const match of selected) {
          const sourceName = sourceNames.get(match[1]) || match[1];
          if (seenSourceNames.has(sourceName)) duplicateSourceNames.add(sourceName);
          seenSourceNames.add(sourceName);
        }
        const assignments = selected.map(match => {
          const [, symbolName, sort] = match;
          const sourceName = sourceNames.get(symbolName) || symbolName;
          const label = duplicateSourceNames.has(sourceName) ? sourceName + " (" + symbolName + ")" : sourceName;
          const symbol = context[sort].const(symbolName);
          const value = modelObject.eval(symbol, true).toString()
            .replace(/^\(-\s+([^()\s]+)\)$/, "-$1")
            .replace(/^\(\/\s+([^()\s]+)\s+([^()\s]+)\)$/, "$1/$2");
          return label + " = " + value;
        });
        results.push({ status: "failed", message: "Z3 found a counterexample.", counterexample: assignments.join(", ") || "the obligation is false for every assignment", model });
      }
      else results.push({ status: "unknown", message: "Z3 returned unknown: " + solver.reasonUnknown() });
    }
    catch (error) {
      results.push({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

run().then(
  results => parentPort.postMessage({ ok: true, results }),
  error => parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }),
);
`;

import {
  FunctionDeclaration,
  NewtypeDeclaration,
  SourceFile,
  TypeAliasDeclaration,
  TypeChecker,
} from "./types.js";
import {
  verificationConstant,
  VerificationSort,
  VerificationTerm,
} from "./verificationIR.js";
import { PendingVerificationTask } from "./verificationTasks.js";

/** Mutable state shared while lowering one declaration into proof obligations. @internal */
export interface VerificationContext {
  readonly checker: TypeChecker;
  readonly sourceFile: SourceFile;
  readonly declaration: FunctionDeclaration | NewtypeDeclaration | TypeAliasDeclaration;
  readonly declarations: Map<string, VerificationSort>;
  readonly symbolNames: Map<string, string>;
  readonly pending: PendingVerificationTask[];
  readonly numberModel: boolean;
  freshIndex: number;
}

/** @internal */
export function createVerificationContext(
  checker: TypeChecker,
  sourceFile: SourceFile,
  declaration: FunctionDeclaration | NewtypeDeclaration | TypeAliasDeclaration,
  pending: PendingVerificationTask[],
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

/** @internal */
export function createVerificationConstant(context: VerificationContext, sourceName: string, sort: VerificationSort): VerificationTerm {
  let smtName: string;
  do smtName = `v${context.freshIndex++}`;
  while (context.declarations.has(smtName));
  context.declarations.set(smtName, sort);
  context.symbolNames.set(smtName, sourceName);
  return { expression: verificationConstant(smtName, sort), sort };
}

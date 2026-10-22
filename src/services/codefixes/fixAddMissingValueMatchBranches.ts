import {
  createCodeFixActionWithoutFixAll,
  registerCodeFix,
} from "../_namespaces/ts.codefix.js";
import {
  DataVariant,
  Diagnostics,
  findAncestor,
  getTokenAtPosition,
  idText,
  isDataVariant,
  isIdentifier,
  isMlttMatchExpression,
  MlttMatchExpression,
  SourceFile,
  StringLiteralType,
  SyntaxKind,
  textChanges,
  TypeChecker,
  TypeFlags,
  UnionType,
} from "../_namespaces/ts.js";

const fixId = "addMissingValueMatchBranches";
const errorCodes = [Diagnostics.Non_exhaustive_value_match_Missing_Colon_0.code];

registerCodeFix({
  errorCodes,
  getCodeActions(context) {
    const token = getTokenAtPosition(context.sourceFile, context.span.start);
    const match = findAncestor(token, isMlttMatchExpression);
    if (!match || match.mlttToken) return undefined;

    const missing = getMissingVariants(match, context.program.getTypeChecker());
    if (!missing.length) return undefined;

    const changes = textChanges.ChangeTracker.with(context, changeTracker => {
      const branchTexts = missing.map(({ name, declaration }) => {
        const fields = declaration?.parameters?.map(parameter => isIdentifier(parameter.name) ? idText(parameter.name) : "value") ?? [];
        return `${name}${fields.length ? `(${fields.join(", ")})` : ""} => undefined`;
      });
      insertBranches(changeTracker, context.sourceFile, match, branchTexts);
    });
    return [createCodeFixActionWithoutFixAll(fixId, changes, Diagnostics.Add_missing_value_match_branches)];
  },
});

function getMissingVariants(match: MlttMatchExpression, checker: TypeChecker): readonly { name: string; declaration?: DataVariant; }[] {
  const scrutineeType = checker.getTypeAtLocation(match.scrutinee);
  const constituents = scrutineeType.flags & TypeFlags.Union ? (scrutineeType as UnionType).types : [scrutineeType];
  const variants = new Map<string, DataVariant | undefined>();
  for (const constituent of constituents) {
    const tag = checker.getPropertyOfType(constituent, "_tag");
    const tagType = tag && checker.getTypeOfSymbolAtLocation(tag, match.scrutinee);
    if (!tagType || !(tagType.flags & TypeFlags.StringLiteral)) continue;
    const declaration = constituent.aliasSymbol?.declarations?.find(isDataVariant);
    variants.set((tagType as StringLiteralType).value, declaration);
  }

  for (const arm of match.arms) {
    if (arm.guard) continue;
    for (const pattern of arm.valuePatterns ?? []) {
      const name = idText(pattern.name);
      if (name === "_") return [];
      if (!pattern.elements?.some(element => element.kind === SyntaxKind.ValueMatchPattern)) variants.delete(name);
    }
  }
  return [...variants].map(([name, declaration]) => ({ name, declaration }));
}

function insertBranches(changeTracker: textChanges.ChangeTracker, sourceFile: SourceFile, match: MlttMatchExpression, branches: readonly string[]): void {
  const closeBracePosition = match.end - 1;
  const lastArm = match.arms[match.arms.length - 1];
  const betweenLastArmAndClose = lastArm ? sourceFile.text.slice(lastArm.end, closeBracePosition) : "";
  const hasSeparator = /^\s*[,;]/.test(betweenLastArmAndClose);
  const lineStart = Math.max(sourceFile.text.lastIndexOf("\n", closeBracePosition - 1) + 1, match.getStart(sourceFile));
  const closeBraceIndent = sourceFile.text.slice(lineStart, closeBracePosition);
  const isMultiline = lineStart > match.getStart(sourceFile) && /^\s*$/.test(closeBraceIndent);

  if (!isMultiline) {
    if (lastArm && !hasSeparator) changeTracker.insertText(sourceFile, lastArm.end, ",");
    const hadSpaceBeforeClose = /\s/.test(sourceFile.text.charAt(closeBracePosition - 1));
    changeTracker.insertText(sourceFile, closeBracePosition, `${hadSpaceBeforeClose ? "" : " "}${branches.join(", ")}${hadSpaceBeforeClose ? " " : ""}`);
    return;
  }

  if (lastArm && !hasSeparator) changeTracker.insertText(sourceFile, lastArm.end, ",");
  const newLine = sourceFile.text.includes("\r\n") ? "\r\n" : "\n";
  const branchIndent = `${closeBraceIndent}  `;
  changeTracker.insertText(sourceFile, lineStart, `${branchIndent}${branches.join(`,${newLine}${branchIndent}`)},${newLine}`);
}

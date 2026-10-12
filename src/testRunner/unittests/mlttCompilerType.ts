import * as documents from "../_namespaces/documents.js";
import * as fakes from "../_namespaces/fakes.js";
import * as Harness from "../_namespaces/Harness.js";
import * as ts from "../_namespaces/ts.js";
import * as vfs from "../_namespaces/vfs.js";

describe("unittests:: MLTT compiler type", () => {
  function createProgram(fileName: string, content: string, options: ts.CompilerOptions) {
    const host = new fakes.CompilerHost(vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument(fileName, content)], cwd: "/" },
    ));
    return ts.createProgram({ host, rootNames: [fileName], options });
  }

  const content = `
    type Identity: Type1 = (A: Type0) -> (value: A) -> A;
    type AlphaEquivalent: Type1 = (T: Type0) -> (item: T) -> T;
    type Constant: Type1 = (A: Type0) -> (value: A) -> Type0;
    type WithUnion: Type1 = (A: Type0) -> A | string;
    type UnionAlphaEquivalent: Type1 = (T: Type0) -> T | string;
  `;
  const program = createProgram("/file.tspp", content, { dependentTypes: true, noLib: true, strict: true });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile("/file.tspp")!;
  const declarations = file.statements.filter(ts.isTypeAliasDeclaration);
  const [identity, alphaEquivalent, constant, withUnion, unionAlphaEquivalent] = declarations.map(declaration => checker.getTypeAtLocation(declaration.type));

  it("uses a dedicated compiler type and preserves native printing", () => {
    assert.strictEqual(identity.flags, ts.TypeFlags.DependentFunction);
    assert.strictEqual(checker.typeToString(identity), "(A: Type0) -> (value: A) -> A");
    assert.strictEqual(checker.typeToTypeNode(identity, file, /*flags*/ undefined)?.kind, ts.SyntaxKind.DependentFunctionType);
  });

  it("uses MLTT definitional equality in type relations", () => {
    assert.isTrue(checker.isTypeAssignableTo(identity, alphaEquivalent));
    assert.isFalse(checker.isTypeAssignableTo(identity, constant));
    assert.isTrue(checker.isTypeAssignableTo(withUnion, unionAlphaEquivalent));
  });

  it("requires the option and a tsppconfig.json config name", () => {
    const source = "type Identity: Type1 = (A: Type0) -> A;";
    const disabled = createProgram("/disabled.tspp", source, { noLib: true });
    assert.include(disabled.getSemanticDiagnostics().map(diagnostic => diagnostic.code), 18069);

    const wrongConfig = createProgram("/wrong.tspp", source, {
      configFilePath: "/tsconfig.json",
      dependentTypes: true,
      noLib: true,
    });
    assert.include(wrongConfig.getSemanticDiagnostics().map(diagnostic => diagnostic.code), 18069);
  });

  it("never enables dependent syntax in .ts files", () => {
    const ordinaryTs = createProgram("/file.ts", "type Identity = (A: Type0) -> A;", {
      configFilePath: "/tsppconfig.json",
      dependentTypes: true,
      noLib: true,
    });
    assert.isNotEmpty(ordinaryTs.getSyntacticDiagnostics());
  });
});

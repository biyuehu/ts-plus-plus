import * as documents from "../_namespaces/documents.js";
import * as fakes from "../_namespaces/fakes.js";
import * as Harness from "../_namespaces/Harness.js";
import * as ts from "../_namespaces/ts.js";
import * as vfs from "../_namespaces/vfs.js";

describe("unittests:: MLTT compiler type", () => {
  const content = `
    type Identity: Type1 = (A: Type0) -> (value: A) -> A;
    type AlphaEquivalent: Type1 = (T: Type0) -> (item: T) -> T;
    type Constant: Type1 = (A: Type0) -> (value: A) -> Type0;
  `;
  const host = new fakes.CompilerHost(vfs.createFromFileSystem(
    Harness.IO,
    /*ignoreCase*/ true,
    { documents: [new documents.TextDocument("/file.tspp", content)], cwd: "/" },
  ));
  const program = ts.createProgram({ host, rootNames: ["/file.tspp"], options: { noLib: true, strict: true } });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile("/file.tspp")!;
  const declarations = file.statements.filter(ts.isTypeAliasDeclaration);
  const [identity, alphaEquivalent, constant] = declarations.map(declaration => checker.getTypeAtLocation(declaration.type));

  it("uses a dedicated compiler type and preserves native printing", () => {
    assert.strictEqual(identity.flags, ts.TypeFlags.DependentFunction);
    assert.strictEqual(checker.typeToString(identity), "(A: Type0) -> (value: A) -> A");
    assert.strictEqual(checker.typeToTypeNode(identity, file, /*flags*/ undefined)?.kind, ts.SyntaxKind.DependentFunctionType);
  });

  it("uses MLTT definitional equality in type relations", () => {
    assert.isTrue(checker.isTypeAssignableTo(identity, alphaEquivalent));
    assert.isFalse(checker.isTypeAssignableTo(identity, constant));
  });
});

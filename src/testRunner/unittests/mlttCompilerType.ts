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
    type StructuralLeft = { value: string };
    type StructuralRight = { value: string };
    type WithStructuralLeft: Type1 = (A: Type0) -> StructuralLeft;
    type WithStructuralRight: Type1 = (A: Type0) -> StructuralRight;
    type Box<T> = { value: T };
    type WithGenericAlias: Type1 = (A: Type0) -> Box<A>;
    type WithStructuralBody: Type1 = (T: Type0) -> { value: T };
  `;
  const program = createProgram("/file.tspp", content, { dependentTypes: true, noLib: true, strict: true });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile("/file.tspp")!;
  const declarations = file.statements.filter(ts.isTypeAliasDeclaration);
  const [identity, alphaEquivalent, constant, withUnion, unionAlphaEquivalent, , , withStructuralLeft, withStructuralRight, , withGenericAlias, withStructuralBody] = declarations.map(declaration => checker.getTypeAtLocation(declaration.type));

  it("uses a dedicated compiler type and preserves native printing", () => {
    assert.strictEqual(identity.flags, ts.TypeFlags.DependentFunction);
    assert.strictEqual(checker.typeToString(identity), "(A: Type0) -> (value: A) -> A");
    assert.strictEqual(checker.typeToTypeNode(identity, file, /*flags*/ undefined)?.kind, ts.SyntaxKind.DependentFunctionType);
  });

  it("uses MLTT definitional equality in type relations", () => {
    assert.isTrue(checker.isTypeAssignableTo(identity, alphaEquivalent));
    assert.isFalse(checker.isTypeAssignableTo(identity, constant));
    assert.isTrue(checker.isTypeAssignableTo(withUnion, unionAlphaEquivalent));
    assert.isTrue(checker.isTypeAssignableTo(withStructuralLeft, withStructuralRight));
    assert.isTrue(checker.isTypeAssignableTo(withGenericAlias, withStructuralBody));
  });

  it("bridges explicitly annotated TypeScript generic function signatures to Pi types", () => {
    const bridged = createProgram(
      "/bridged.tspp",
      `
      type DependentIdentity: Type1 = (A: Type0) -> (value: A) -> A;
      type GenericIdentity = <A>(value: A) => A;
      type WrongResult = <A>(value: A) => string;
    `,
      { dependentTypes: true, noLib: true, strict: true },
    );
    const bridgedChecker = bridged.getTypeChecker();
    const bridgedFile = bridged.getSourceFile("/bridged.tspp")!;
    const [dependent, generic, wrong] = bridgedFile.statements
      .filter(ts.isTypeAliasDeclaration)
      .map(declaration => bridgedChecker.getTypeAtLocation(declaration.type));

    assert.isTrue(bridgedChecker.isTypeAssignableTo(generic, dependent));
    assert.isTrue(bridgedChecker.isTypeAssignableTo(dependent, generic));
    assert.isFalse(bridgedChecker.isTypeAssignableTo(wrong, dependent));
  });

  it("exposes callable signatures for dependent functions and reuses TypeScript inference", () => {
    const callable = createProgram(
      "/callable.tspp",
      `
      type DependentIdentity: Type1 = (A: Type0) -> (value: A) -> A;
      declare const identity: DependentIdentity;
      const explicit = identity<string>("explicit");
      const inferred = identity("inferred");
    `,
      { dependentTypes: true, noLib: true, strict: true },
    );
    const callableChecker = callable.getTypeChecker();
    const callableFile = callable.getSourceFile("/callable.tspp")!;
    const declarations = callableFile.statements.filter(ts.isVariableStatement)
      .flatMap(statement => [...statement.declarationList.declarations]);

    assert.isEmpty(callable.getSemanticDiagnostics());
    assert.strictEqual(callableChecker.typeToString(callableChecker.getTypeAtLocation(declarations[1].name)), "string");
    assert.strictEqual(callableChecker.typeToString(callableChecker.getTypeAtLocation(declarations[2].name)), '"inferred"');
  });

  it("supports built-in natural-number indices and infers numeric literals at calls", () => {
    const naturals = createProgram(
      "/naturals.tspp",
      `
      type Vector<N extends number, A> = { length: N; value: A };
      type VectorBuilder: Type1 = (A: Type0) -> (value: A) -> (N: Nat) -> Vector<N, A>;
      type EmptyVector: Type1 = (A: Type0) -> Vector<Zero, A>;
      type TwoVector: Type1 = (A: Type0) -> Vector<Succ<Succ<Zero>>, A>;
      declare const buildVector: VectorBuilder;
      const pair = buildVector("item", 2);
    `,
      { dependentTypes: true, noLib: true, strict: true },
    );
    const naturalsChecker = naturals.getTypeChecker();
    const naturalsFile = naturals.getSourceFile("/naturals.tspp")!;
    const pair = naturalsFile.statements
      .filter(ts.isVariableStatement)
      .flatMap(statement => [...statement.declarationList.declarations])[1];

    const diagnostics = naturals.getSemanticDiagnostics();
    assert.isEmpty(diagnostics, diagnostics.map(diagnostic => diagnostic.messageText.toString()).join("\n"));
    assert.strictEqual(naturalsChecker.typeToString(naturalsChecker.getTypeAtLocation(pair.name)), "Vector<2, string>");
  });

  it("checks that Succ is applied to a natural number", () => {
    const invalid = createProgram(
      "/invalid-nat.tspp",
      "type Invalid: Type1 = (N: Nat) -> Succ<string>;",
      { dependentTypes: true, noLib: true, strict: true },
    );

    assert.match(invalid.getSemanticDiagnostics()[0].messageText.toString(), /Expected Nat, but inferred Type0/);
  });

  it("preserves the real universe of embedded TypeScript aliases", () => {
    const higherCodomain = createProgram(
      "/higher.tspp",
      "type Identity: Type1 = (A: Type0) -> A; type HigherCodomain: Type1 = (ignored: string) -> Identity;",
      { dependentTypes: true, noLib: true },
    );
    assert.isEmpty(higherCodomain.getSemanticDiagnostics());
  });

  it("rejects higher-universe types hidden inside TypeScript composites", () => {
    const invalid = createProgram("/invalid.tspp", "type Invalid: Type1 = (A: Type0) -> A | ((B: Type0) -> B);", {
      dependentTypes: true,
      noLib: true,
    });
    assert.include(invalid.getSemanticDiagnostics().map(diagnostic => diagnostic.code), 18062);
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

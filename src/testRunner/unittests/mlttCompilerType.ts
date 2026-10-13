import * as documents from "../_namespaces/documents.js";
import * as fakes from "../_namespaces/fakes.js";
import * as Harness from "../_namespaces/Harness.js";
import * as ts from "../_namespaces/ts.js";
import * as vfs from "../_namespaces/vfs.js";

describe("unittests:: MLTT compiler type", () => {
  const allFeatures: string[] = [
    "higherKindedTypes",
    "typeUniverses",
    "dependentFunctionTypes",
    "dependentFunctionInterop",
    "naturalNumbers",
    "naturalNumberAddition",
    "naturalNumberElimination",
    "identityTypes",
    "sigmaTypes",
  ];

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
  const program = createProgram("/file.tspp", content, { tsppFeatures: allFeatures, noLib: true, strict: true });
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
      { tsppFeatures: allFeatures, noLib: true, strict: true },
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
      { tsppFeatures: allFeatures, noLib: true, strict: true },
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
      type ComputedTwoVector: Type1 = (A: Type0) -> Vector<NatAdd<Succ<Zero>, Succ<Zero>>, A>;
      declare const buildVector: VectorBuilder;
      const pair = buildVector("item", 2);
    `,
      { tsppFeatures: allFeatures, noLib: true, strict: true },
    );
    const naturalsChecker = naturals.getTypeChecker();
    const naturalsFile = naturals.getSourceFile("/naturals.tspp")!;
    const pair = naturalsFile.statements
      .filter(ts.isVariableStatement)
      .flatMap(statement => [...statement.declarationList.declarations])[1];

    const diagnostics = naturals.getSemanticDiagnostics();
    assert.isEmpty(diagnostics, diagnostics.map(diagnostic => diagnostic.messageText.toString()).join("\n"));
    assert.strictEqual(naturalsChecker.typeToString(naturalsChecker.getTypeAtLocation(pair.name)), "Vector<2, string>");
    const aliases = naturalsFile.statements.filter(ts.isTypeAliasDeclaration);
    const twoVector = naturalsChecker.getTypeAtLocation(aliases[3].type);
    const computedTwoVector = naturalsChecker.getTypeAtLocation(aliases[4].type);
    assert.isTrue(naturalsChecker.isTypeAssignableTo(twoVector, computedTwoVector));
  });

  it("rejects non-natural TypeScript values at Nat call boundaries", () => {
    const invalidNaturals = createProgram(
      "/invalid-natural-calls.tspp",
      `
      type Vector<N extends number> = { length: N };
      type Builder: Type0 = (N: Nat) -> Vector<N>;
      declare const build: Builder;
      declare let dynamicNumber: number;
      build(-1);
      build(1.5);
      build(9007199254740992);
      build(dynamicNumber);
      build(3);
    `,
      { tsppFeatures: allFeatures, noLib: true, strict: true },
    );

    const diagnostics = invalidNaturals.getSemanticDiagnostics();
    assert.deepEqual(diagnostics.map(diagnostic => diagnostic.code), [18077, 18077, 18077, 18077]);
  });

  it("supports @ts-expect-error for TS++ kind, MLTT, and runtime-boundary diagnostics", () => {
    const expectedErrors = createProgram(
      "/expected-errors.tspp",
      `
      type Functor<F: Type0 => Type0> = F<string>;
      // @ts-expect-error -- string does not have the required higher kind
      type InvalidFunctor = Functor<string>;
      // @ts-expect-error -- this dependent function belongs to Type1
      type WrongUniverse: Type0 = (A: Type0) -> A;
      // @ts-expect-error -- Missing is not bound by the Pi type
      type UnboundName: Type1 = (A: Type0) -> Missing;
      // @ts-expect-error -- Succ expects a Nat term
      type WrongSuccessor: Type0 = (N: Nat) -> Succ<string>;
      declare const buildAt: (N: Nat) -> { index: N };
      // @ts-expect-error -- negative values cannot cross the Nat runtime boundary
      buildAt(-1);
    `,
      { tsppFeatures: allFeatures, noLib: true, strict: true },
    );

    assert.isEmpty(expectedErrors.getSemanticDiagnostics());
  });

  it("reports an unused @ts-expect-error in a TS++ source file", () => {
    const unusedDirective = createProgram(
      "/unused-expect-error.tspp",
      `
      // @ts-expect-error -- deliberately unused
      type Valid: Type0 = string;
    `,
      { tsppFeatures: allFeatures, noLib: true, strict: true },
    );

    assert.deepEqual(unusedDirective.getSemanticDiagnostics().map(diagnostic => diagnostic.code), [2578]);
  });

  it("checks that Succ is applied to a natural number", () => {
    const invalid = createProgram(
      "/invalid-nat.tspp",
      "type Invalid: Type1 = (N: Nat) -> Succ<string>;",
      { tsppFeatures: allFeatures, noLib: true, strict: true },
    );

    assert.match(invalid.getSemanticDiagnostics()[0].messageText.toString(), /Expected Nat, but inferred Type0/);
  });

  it("exposes identity types, reflexivity, and the Nat eliminator", () => {
    const proofs = createProgram(
      "/proofs.tspp",
      `
      type NatZeroLaw: Type1 =
        (P: (N: Nat) -> Type0) ->
        (zeroCase: P<Zero>) ->
        (successorCase: (N: Nat) -> (previous: P<N>) -> P<Succ<N>>) ->
        Eq<P<Zero>, NatElim<P, zeroCase, successorCase, Zero>, zeroCase>;

      type Reflexivity: Type1 =
        (A: Type0) -> (value: A) -> Eq<A, value, value>;

      type ReflexivityProof: Type1 =
        (A: Type0) -> (value: A) -> Eq<Eq<A, value, value>, Refl<A, value>, Refl<A, value>>;
    `,
      { tsppFeatures: allFeatures, noLib: true, strict: true },
    );

    assert.isEmpty(proofs.getSemanticDiagnostics());
  });

  it("exposes path induction and its reflexivity computation rule", () => {
    const pathInduction = createProgram(
      "/path-induction.tspp",
      `
      type PathInduction: Type1 =
        (Motive: (left: Nat) -> (right: Nat) -> (proof: Eq<Nat, left, right>) -> Type0) ->
        (reflexivityCase: (value: Nat) -> Motive<value, value, Refl<Nat, value>>) ->
        (left: Nat) ->
        (right: Nat) ->
        (proof: Eq<Nat, left, right>) ->
        Motive<left, right, proof>;

      type PathInductionComputed: Type1 =
        (Motive: (left: Nat) -> (right: Nat) -> (proof: Eq<Nat, left, right>) -> Type0) ->
        (reflexivityCase: (value: Nat) -> Motive<value, value, Refl<Nat, value>>) ->
        (value: Nat) ->
        Eq<
          Motive<value, value, Refl<Nat, value>>,
          J<Nat, Motive, reflexivityCase, value, value, Refl<Nat, value>>,
          reflexivityCase<value>
        >;

      type ClosedJComputation: Type0 = Eq<
        Nat,
        J<
          Nat,
          Ann<
            Lam<(left: Nat) -> Lam<(right: Nat) -> Lam<(proof: Eq<Nat, left, right>) -> Nat>>>,
            (left: Nat) -> (right: Nat) -> (proof: Eq<Nat, left, right>) -> Type0
          >,
          Ann<Lam<(value: Nat) -> Zero>, (value: Nat) -> Nat>,
          Zero,
          Zero,
          Refl<Nat, Zero>
        >,
        Zero
      >;
    `,
      { tsppFeatures: allFeatures, noLib: true, strict: true },
    );

    assert.isEmpty(pathInduction.getSemanticDiagnostics());
  });

  it("allows closed MLTT types outside a Pi surface context", () => {
    const standalone = createProgram(
      "/standalone-mltt.tspp",
      `
      type ZeroEqualsZero: Type0 = Eq<Nat, Zero, Zero>;
      type SingletonNat: Type0 = Sigma<(value: Nat) -> Eq<Nat, value, Zero>>;
      type ReducedFirst: Type0 = Eq<
        Nat,
        First<Pair<Sigma<(value: Nat) -> Eq<Nat, value, Zero>>, Zero, Refl<Nat, Zero>>>,
        Zero
      >;
      type ClosedNatElim: Type0 = Eq<
        Nat,
        NatElim<
          Ann<Lam<(value: Nat) -> Nat>, (value: Nat) -> Type0>,
          Zero,
          Ann<
            Lam<(value: Nat) -> Lam<(previous: Nat) -> Succ<previous>>>,
            (value: Nat) -> (previous: Nat) -> Nat
          >,
          Succ<Zero>
        >,
        Succ<Zero>
      >;
    `,
      { tsppFeatures: allFeatures, noLib: true, strict: true },
    );

    const diagnostics = standalone.getSemanticDiagnostics();
    assert.isEmpty(diagnostics, diagnostics.map(diagnostic => diagnostic.messageText.toString()).join("\n"));
  });

  it("checks Lam binder annotations against Ann Pi domains", () => {
    const invalidLambda = createProgram(
      "/invalid-lambda.tspp",
      `
      type Invalid: Type0 =
        (expected: (value: Nat) -> Nat) ->
        Eq<
          (value: Nat) -> Nat,
          Ann<Lam<(value: string) -> value>, (value: Nat) -> Nat>,
          expected
        >;
    `,
      { tsppFeatures: allFeatures, noLib: true, strict: true },
    );

    assert.match(invalidLambda.getSemanticDiagnostics()[0].messageText.toString(), /Lambda parameter annotation string does not match expected domain Nat/);
  });

  it("exposes Sigma types, pair construction, and projections", () => {
    const sigma = createProgram(
      "/sigma.tspp",
      `
      type SigmaFirstLaw: Type0 =
        (N: Nat) ->
        Eq<
          Nat,
          First<Pair<Sigma<(value: Nat) -> Eq<Nat, value, N>>, N, Refl<Nat, N>>>,
          N
        >;

      type SigmaSecondLaw: Type0 =
        (N: Nat) ->
        Eq<
          Eq<Nat, N, N>,
          Second<Pair<Sigma<(value: Nat) -> Eq<Nat, value, N>>, N, Refl<Nat, N>>>,
          Refl<Nat, N>
        >;
    `,
      { tsppFeatures: allFeatures, noLib: true, strict: true },
    );

    assert.isEmpty(sigma.getSemanticDiagnostics());
  });

  it("preserves the real universe of embedded TypeScript aliases", () => {
    const higherCodomain = createProgram(
      "/higher.tspp",
      "type Identity: Type1 = (A: Type0) -> A; type HigherCodomain: Type1 = (ignored: string) -> Identity;",
      { tsppFeatures: allFeatures, noLib: true },
    );
    assert.isEmpty(higherCodomain.getSemanticDiagnostics());
  });

  it("rejects higher-universe types hidden inside TypeScript composites", () => {
    const invalid = createProgram("/invalid.tspp", "type Invalid: Type1 = (A: Type0) -> A | ((B: Type0) -> B);", {
      tsppFeatures: allFeatures,
      noLib: true,
    });
    assert.include(invalid.getSemanticDiagnostics().map(diagnostic => diagnostic.code), 18062);
  });

  it("requires the dependent-function feature", () => {
    const source = "type Identity: Type1 = (A: Type0) -> A;";
    const disabled = createProgram("/disabled.tspp", source, { configFilePath: "/tsppconfig.json", noLib: true });
    assert.include(disabled.getSemanticDiagnostics().map(diagnostic => diagnostic.code), 18072);
  });

  it("never enables dependent syntax in .ts files", () => {
    const ordinaryTs = createProgram("/file.ts", "type Identity = (A: Type0) -> A;", {
      configFilePath: "/tsppconfig.json",
      tsppFeatures: allFeatures,
      noLib: true,
    });
    assert.isNotEmpty(ordinaryTs.getSyntacticDiagnostics());
  });
});

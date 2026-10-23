import * as mltt from "../../compiler/mlttCore.js";

describe("unittests:: MLTT core", () => {
  const type0 = mltt.mlttUniverse(0);

  // Pi (A: Type0). Pi (_: A). A
  const polymorphicIdentityType = mltt.mlttPi(
    "A",
    type0,
    mltt.mlttPi("value", mltt.mlttVariable(0), mltt.mlttVariable(1)),
  );

  // lambda A. lambda value. value
  const polymorphicIdentity = mltt.mlttLambda("A", mltt.mlttLambda("value", mltt.mlttVariable(0)));

  function assertMlttError(action: () => void, code: mltt.MlttTypeError["code"]): void {
    try {
      action();
      assert.fail(`Expected MLTT error ${code}.`);
    }
    catch (error) {
      assert.instanceOf(error, mltt.MlttTypeError);
      assert.strictEqual(error.code, code);
    }
  }

  it("places each universe in its successor", () => {
    assert.deepEqual(mltt.inferMlttType(type0), mltt.mlttUniverse(1));
    assert.deepEqual(mltt.inferMlttType(mltt.mlttUniverse(4)), mltt.mlttUniverse(5));
  });

  it("checks and computes the dependent Bool eliminator", () => {
    const bool = mltt.mlttBoolType();
    const motive = mltt.mlttAnnotation(
      mltt.mlttLambda("value", mltt.mlttIdentityType(bool, mltt.mlttVariable(0), mltt.mlttVariable(0))),
      mltt.mlttPi("value", bool, type0),
    );
    const trueCase = mltt.mlttRefl(bool, mltt.mlttTrue());
    const falseCase = mltt.mlttRefl(bool, mltt.mlttFalse());
    const whenTrue = mltt.mlttBoolElim(motive, trueCase, falseCase, mltt.mlttTrue());
    const whenFalse = mltt.mlttBoolElim(motive, trueCase, falseCase, mltt.mlttFalse());

    assert.deepEqual(mltt.inferMlttType(bool), type0);
    assert.deepEqual(mltt.inferMlttType(mltt.mlttTrue()), bool);
    assert.deepEqual(mltt.inferMlttType(mltt.mlttFalse()), bool);
    assert.deepEqual(mltt.normalizeMlttTerm(whenTrue), trueCase);
    assert.deepEqual(mltt.normalizeMlttTerm(whenFalse), falseCase);
    assert.isTrue(mltt.areMlttTermsDefinitionallyEqual(whenTrue, trueCase));
    assert.isTrue(mltt.areMlttTermsDefinitionallyEqual(whenFalse, falseCase));
  });

  it("rejects Bool elimination with a non-Bool scrutinee", () => {
    const bool = mltt.mlttBoolType();
    const motive = mltt.mlttAnnotation(
      mltt.mlttLambda("value", mltt.mlttNatType()),
      mltt.mlttPi("value", bool, type0),
    );
    assertMlttError(
      () => mltt.inferMlttType(mltt.mlttBoolElim(motive, mltt.mlttZero(), mltt.mlttZero(), mltt.mlttZero())),
      "type-mismatch",
    );
  });

  it("compares type shapes with equal, apart, and stuck outcomes", () => {
    assert.strictEqual(mltt.compareMlttTermsDefinitionally(mltt.mlttBoolType(), mltt.mlttBoolType()), "equal");
    assert.strictEqual(mltt.compareMlttTermsDefinitionally(mltt.mlttBoolType(), mltt.mlttNatType()), "apart");
    assert.strictEqual(mltt.compareMlttTermsDefinitionally(mltt.mlttVariable(0), mltt.mlttBoolType()), "stuck");
  });

  it("computes ordered type matches and keeps open matches stuck", () => {
    const closed = mltt.mlttTypeMatch(
      mltt.mlttBoolType(),
      [
        { pattern: mltt.mlttNatType(), result: mltt.mlttNatType() },
        { pattern: mltt.mlttBoolType(), result: mltt.mlttBoolType() },
      ],
      mltt.mlttNatType(),
    );
    const open = mltt.mlttTypeMatch(
      mltt.mlttVariable(0),
      [{ pattern: mltt.mlttBoolType(), result: mltt.mlttNatType() }],
      mltt.mlttBoolType(),
    );

    assert.deepEqual(mltt.inferMlttType(closed), type0);
    assert.deepEqual(mltt.normalizeMlttTerm(closed), mltt.mlttBoolType());
    assert.deepEqual(mltt.inferMlttType(open, [type0]), type0);
    assert.deepEqual(mltt.normalizeMlttTerm(open), open);

    const applied = mltt.mlttApplication(mltt.mlttLambda("A", open), mltt.mlttBoolType());
    assert.deepEqual(mltt.normalizeMlttTerm(applied), mltt.mlttNatType());
  });

  it("substitutes captures produced by an external type pattern", () => {
    const stringType = mltt.mlttExternal("string", "string", [], type0);
    const arrayOfString = mltt.mlttExternal("Array<string>", "Array<string>", [], type0);
    const arrayPattern = mltt.mlttExternal("Array<$0>", "Array<infer T>", [mltt.mlttVariable(0)], type0);
    const match = mltt.mlttTypeMatch(
      arrayOfString,
      [{
        pattern: arrayPattern,
        captures: [{ name: "T", type: type0 }],
        result: mltt.mlttVariable(0),
      }],
      mltt.mlttBoolType(),
    );

    assert.deepEqual(
      mltt.normalizeMlttTerm(
        match,
        /*compareExternal*/ undefined,
        () => ({ kind: "matched", captures: [stringType] }),
      ),
      stringType,
    );
  });

  it("requires every type-match result to inhabit the same universe", () => {
    assertMlttError(
      () =>
        mltt.inferMlttType(mltt.mlttTypeMatch(
          mltt.mlttBoolType(),
          [{ pattern: mltt.mlttBoolType(), result: type0 }],
          mltt.mlttNatType(),
        )),
      "type-mismatch",
    );
  });

  it("provides Nat, Zero, and Succ as typed core primitives", () => {
    assert.deepEqual(mltt.inferMlttType(mltt.mlttNatType()), type0);
    assert.deepEqual(mltt.inferMlttType(mltt.mlttZero()), mltt.mlttNatType());
    assert.deepEqual(
      mltt.inferMlttType(mltt.mlttSuccessor(mltt.mlttSuccessor(mltt.mlttZero()))),
      mltt.mlttNatType(),
    );
    assert.strictEqual(
      mltt.printMlttTerm(mltt.mlttSuccessor(mltt.mlttSuccessor(mltt.mlttZero()))),
      "Succ<Succ<Zero>>",
    );
  });

  it("rejects a successor whose predecessor is not a natural number", () => {
    assertMlttError(() => mltt.inferMlttType(mltt.mlttSuccessor(type0)), "type-mismatch");
  });

  it("normalizes structurally recursive natural-number addition", () => {
    const one = mltt.mlttSuccessor(mltt.mlttZero());
    const two = mltt.mlttSuccessor(one);
    const three = mltt.mlttSuccessor(two);

    assert.deepEqual(mltt.inferMlttType(mltt.mlttNatAdd(one, two)), mltt.mlttNatType());
    assert.deepEqual(mltt.normalizeMlttTerm(mltt.mlttNatAdd(one, two)), three);
    assert.isTrue(mltt.areMlttTermsDefinitionallyEqual(mltt.mlttNatAdd(one, two), three));
  });

  it("checks and computes the dependent Nat eliminator", () => {
    const motive = mltt.mlttAnnotation(
      mltt.mlttLambda("n", mltt.mlttNatType()),
      mltt.mlttPi("n", mltt.mlttNatType(), type0),
    );
    const successorCase = mltt.mlttLambda(
      "n",
      mltt.mlttLambda("previous", mltt.mlttSuccessor(mltt.mlttVariable(0))),
    );
    const two = mltt.mlttSuccessor(mltt.mlttSuccessor(mltt.mlttZero()));
    const eliminated = mltt.mlttNatElim(motive, mltt.mlttZero(), successorCase, two);

    assert.isTrue(mltt.areMlttTermsDefinitionallyEqual(mltt.inferMlttType(eliminated), mltt.mlttNatType()));
    assert.deepEqual(mltt.normalizeMlttTerm(eliminated), two);
  });

  it("forms identity types and checks reflexivity proofs", () => {
    const equality = mltt.mlttIdentityType(mltt.mlttNatType(), mltt.mlttZero(), mltt.mlttZero());
    const reflexivity = mltt.mlttRefl(mltt.mlttNatType(), mltt.mlttZero());

    assert.deepEqual(mltt.inferMlttType(equality), type0);
    assert.deepEqual(mltt.inferMlttType(reflexivity), equality);
    assert.doesNotThrow(() => mltt.checkMlttType(reflexivity, equality));
  });

  it("checks and computes identity elimination", () => {
    const motiveType = mltt.mlttPi(
      "left",
      mltt.mlttNatType(),
      mltt.mlttPi(
        "right",
        mltt.mlttNatType(),
        mltt.mlttPi(
          "proof",
          mltt.mlttIdentityType(mltt.mlttNatType(), mltt.mlttVariable(1), mltt.mlttVariable(0)),
          type0,
        ),
      ),
    );
    const motive = mltt.mlttAnnotation(
      mltt.mlttLambda("left", mltt.mlttLambda("right", mltt.mlttLambda("proof", mltt.mlttNatType()))),
      motiveType,
    );
    const reflexivityCase = mltt.mlttLambda("value", mltt.mlttZero());
    const equality = mltt.mlttRefl(mltt.mlttNatType(), mltt.mlttZero());
    const eliminated = mltt.mlttIdentityElim(
      mltt.mlttNatType(),
      motive,
      reflexivityCase,
      mltt.mlttZero(),
      mltt.mlttZero(),
      equality,
    );

    assert.isTrue(mltt.areMlttTermsDefinitionallyEqual(mltt.inferMlttType(eliminated), mltt.mlttNatType()));
    assert.deepEqual(mltt.normalizeMlttTerm(eliminated), mltt.mlttZero());
  });

  it("forms dependent pairs and reduces both projections", () => {
    const sigma = mltt.mlttSigma(
      "n",
      mltt.mlttNatType(),
      mltt.mlttIdentityType(mltt.mlttNatType(), mltt.mlttVariable(0), mltt.mlttVariable(0)),
    );
    const proof = mltt.mlttRefl(mltt.mlttNatType(), mltt.mlttZero());
    const pair = mltt.mlttPair(sigma, mltt.mlttZero(), proof);

    assert.deepEqual(mltt.inferMlttType(sigma), type0);
    assert.deepEqual(mltt.inferMlttType(pair), sigma);
    assert.deepEqual(mltt.normalizeMlttTerm(mltt.mlttFirst(pair)), mltt.mlttZero());
    assert.deepEqual(mltt.normalizeMlttTerm(mltt.mlttSecond(pair)), proof);
  });

  it("forms dependent Pi types", () => {
    assert.deepEqual(mltt.inferMlttType(polymorphicIdentityType), mltt.mlttUniverse(1));
  });

  it("checks a genuinely dependent polymorphic identity", () => {
    assert.doesNotThrow(() => mltt.checkMlttType(polymorphicIdentity, polymorphicIdentityType));
    assert.deepEqual(
      mltt.inferMlttType(mltt.mlttAnnotation(polymorphicIdentity, polymorphicIdentityType)),
      polymorphicIdentityType,
    );
  });

  it("uses beta reduction for definitional equality", () => {
    const betaRedex = mltt.mlttApplication(
      mltt.mlttLambda("A", mltt.mlttPi("value", mltt.mlttVariable(0), mltt.mlttVariable(1))),
      type0,
    );
    const reduced = mltt.mlttPi("value", type0, type0);

    assert.isTrue(mltt.areMlttTermsDefinitionallyEqual(betaRedex, reduced));
    assert.deepEqual(mltt.normalizeMlttTerm(betaRedex), reduced);
  });

  it("substitutes MLTT binders captured by external TypeScript types", () => {
    const stringType = mltt.mlttExternal("string", "string", [], type0);
    const dependentUnion = mltt.mlttExternal("$0 | string", "A | string", [mltt.mlttVariable(0)], type0);
    const applied = mltt.mlttApplication(mltt.mlttLambda("A", dependentUnion), stringType);
    const expected = mltt.mlttExternal("$0 | string", "A | string", [stringType], type0);

    assert.isTrue(mltt.areMlttTermsDefinitionallyEqual(applied, expected));
  });

  it("lets the host compare external types without exposing their identities to the core", () => {
    const leftIdentity = {};
    const rightIdentity = {};
    const left = mltt.mlttExternal("left display key", "Left", [], type0, leftIdentity);
    const right = mltt.mlttExternal("right display key", "Right", [], type0, rightIdentity);

    assert.isFalse(mltt.areMlttTermsDefinitionallyEqual(left, right));
    assert.isTrue(mltt.areMlttTermsDefinitionallyEqual(left, right, (leftExternal, rightExternal) => leftExternal.identity === leftIdentity && rightExternal.identity === rightIdentity));
    assert.strictEqual((mltt.normalizeMlttTerm(left) as mltt.MlttExternal).identity, leftIdentity);
  });

  it("substitutes a dependent codomain after application", () => {
    const identityOverType1 = mltt.mlttAnnotation(
      polymorphicIdentity,
      mltt.mlttPi(
        "A",
        mltt.mlttUniverse(1),
        mltt.mlttPi("value", mltt.mlttVariable(0), mltt.mlttVariable(1)),
      ),
    );

    assert.deepEqual(
      mltt.inferMlttType(mltt.mlttApplication(identityOverType1, type0)),
      mltt.mlttPi("value", type0, type0),
    );
  });

  it("ignores binder names when comparing terms", () => {
    assert.isTrue(mltt.areMlttTermsDefinitionallyEqual(
      mltt.mlttPi("left", type0, mltt.mlttVariable(0)),
      mltt.mlttPi("right", type0, mltt.mlttVariable(0)),
    ));
  });

  it("rejects applying a function to a term of the wrong universe", () => {
    const identityAtType0 = mltt.mlttAnnotation(
      mltt.mlttLambda("A", mltt.mlttVariable(0)),
      mltt.mlttPi("A", type0, type0),
    );
    const invalidApplication = mltt.mlttApplication(identityAtType0, type0);

    assertMlttError(() => mltt.inferMlttType(invalidApplication), "type-mismatch");
  });

  it("rejects unbound variables and unannotated lambdas", () => {
    assertMlttError(() => mltt.inferMlttType(mltt.mlttVariable(0)), "unbound-variable");
    assertMlttError(() => mltt.inferMlttType(polymorphicIdentity), "cannot-infer-lambda");
  });

  it("checks explicit lambda parameter annotations", () => {
    const stringType = mltt.mlttExternal("string", "string", [], type0);
    const annotatedLambda = mltt.mlttLambda("value", mltt.mlttVariable(0), stringType);
    assertMlttError(
      () => mltt.checkMlttType(annotatedLambda, mltt.mlttPi("value", mltt.mlttNatType(), mltt.mlttNatType())),
      "type-mismatch",
    );
  });
});

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
});

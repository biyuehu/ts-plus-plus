import * as documents from "../../_namespaces/documents.js";
import * as fakes from "../../_namespaces/fakes.js";
import * as Harness from "../../_namespaces/Harness.js";
import * as ts from "../../_namespaces/ts.js";
import * as vfs from "../../_namespaces/vfs.js";

describe("unittests:: tspp:: type computation: let bindings", () => {
  function letMessages(content: string, tsppFeatures: string[] = ["typeComputation"]) {
    const host = new fakes.CompilerHost(vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument("/file.tspp", content)], cwd: "/" },
    ));
    const program = ts.createProgram({ host, rootNames: ["/file.tspp"], options: { noLib: true, strict: true, tsppFeatures } });
    return program.getSemanticDiagnostics().map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  }

  it("binds a name that the body can use", () => {
    const messages = letMessages(`
      type Twice<T> = let X = { value: T } in { first: X; second: X };
      const ok: Twice<number> = { first: { value: 1 }, second: { value: 2 } };
      const bad: Twice<number> = { first: { value: 1 }, second: { value: "x" } };
    `);
    assert.lengthOf(messages, 1, messages.join("\n"));
    assert.match(messages[0], /not assignable/);
  });

  it("does not leak the binding outside the body", () => {
    const messages = letMessages(`
      type Y = let X = number in X;
      const leak: X = 1;
    `);
    assert.isNotEmpty(messages, messages.join("\n"));
  });

  it("lets an inner binding shadow an outer one", () => {
    const messages = letMessages(`
      type Y = let X = number in let X = string in X;
      const ok: Y = "s";
      const bad: Y = 1;
    `);
    assert.lengthOf(messages, 1, messages.join("\n"));
    assert.match(messages[0], /not assignable/);
  });

  it("resolves the value of a shadowing binding in the outer scope", () => {
    const messages = letMessages(`
      type X = number;
      type Y = let X = X in X;
      const ok: Y = 1;
      const bad: Y = "x";
    `);
    assert.lengthOf(messages, 1, messages.join("\n"));
    assert.match(messages[0], /not assignable/);
  });

  it("rejects a binding that refers to itself", () => {
    const messages = letMessages(`
      type Y = let X = X in X;
    `);
    assert.isNotEmpty(messages, messages.join("\n"));
  });

  it("reports error on unbound type variable in let binding", () => {
    const messages = letMessages(`
      type Id<t> = let x = T in x;
    `);
    assert.lengthOf(messages, 1, messages.join("\n"));
    assert.match(messages[0], /Cannot find name 'T'/);
  });

  it("works inside a conditional type", () => {
    const messages = letMessages(`
      type Y<T> = T extends string ? let X = T in [X, X] : never;
      const ok: Y<"a"> = ["a", "a"];
      const bad: Y<"a"> = ["a", "b"];
    `);
    assert.lengthOf(messages, 1, messages.join("\n"));
  });

  it("is preserved in declaration emit", () => {
    const host = new fakes.CompilerHost(vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument("/file.tspp", `export type Y<T> = let X = { value: T } in [X, X];`)], cwd: "/" },
    ));
    const program = ts.createProgram({ host, rootNames: ["/file.tspp"], options: { noLib: true, strict: true, declaration: true, emitDeclarationOnly: true, tsppFeatures: ["typeComputation"] } });
    let output = "";
    program.emit(/*targetSourceFile*/ undefined, (_name, text) => output += text);
    assert.include(output, "let X =", output);
    assert.include(output, " in ", output);
  });

  it("requires typeComputation to be enabled", () => {
    const messages = letMessages(
      `
      type Y = let X = number in X;
    `,
      [],
    );
    assert.match(messages.join("\n"), /typeComputation/);
  });
});

describe("unittests:: tspp:: type computation: match", () => {
  function matchMessages(content: string, tsppFeatures: string[] = ["typeComputation"]) {
    const host = new fakes.CompilerHost(vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument("/file.tspp", content)], cwd: "/" },
    ));
    const program = ts.createProgram({ host, rootNames: ["/file.tspp"], options: { noLib: true, strict: true, tsppFeatures } });
    return program.getSemanticDiagnostics().map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  }

  it("matches literal types in order with => and : separators", () => {
    const messages = matchMessages(`
      type Name<T> = match T { 1 => "one", 2: "two", _ => "many" };
      const a: Name<1> = "one";
      const b: Name<2> = "two";
      const c: Name<7> = "many";
      const bad: Name<1> = "two";
    `);
    assert.lengthOf(messages, 1, messages.join("\n"));
    assert.match(messages[0], /not assignable/);
  });

  it("captures structural members with infer and does not distribute", () => {
    const messages = matchMessages(`
      type Value<T> = match T { { value: infer U }: U, _: never };
      const ok: Value<{ value: 1 }> = 1;
      const bad: Value<{ value: 1 }> = 2;
    `);
    assert.lengthOf(messages, 1, messages.join("\n"));
    assert.match(messages[0], /not assignable/);
  });

  it("supports colon separator and arbitrary infer patterns", () => {
    const messages = matchMessages(`
      interface Array<T> {}
      type Id<t> = match t {
        Array<infer U>: 1,
      };
      const ok: Id<Array<number>> = 1;
      const bad: Id<Array<number>> = 2;
    `);
    assert.lengthOf(messages, 1, messages.join("\n"));
    assert.match(messages[0], /not assignable/);
  });

  it("matches ADT type constructors, primitives and literals", () => {
    const messages = matchMessages(
      `
      data Maybe<T> = Nothing | Just(value: T);
      type Classify<T> = match T {
        [infer A, infer B]: [B, A],
        Maybe<infer U>: U,
        1: "one",
        false: "false",
        string: "is-string",
        number: "is-number",
        _: "other"
      };
      const a: Classify<[number, string]> = ["hello", 1];
      const b: Classify<Maybe<boolean>> = true;
      const c: Classify<1> = "one";
      const d: Classify<false> = "false";
      const e: Classify<string> = "is-string";
      const f: Classify<number> = "is-number";
      const g: Classify<symbol> = "other";
      const bad: Classify<1> = "false";
    `,
      ["typeComputation", "dataDeclarations"],
    );
    assert.lengthOf(messages, 1, messages.join("\n"));
    assert.match(messages[0], /not assignable/);
  });
});

describe("unittests:: tspp:: type computation: type lambdas", () => {
  function lambdaMessages(content: string, tsppFeatures: string[] = ["typeComputation", "higherKindedTypes", "typeUniverses"]) {
    const host = new fakes.CompilerHost(vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument("/file.tspp", content)], cwd: "/" },
    ));
    const program = ts.createProgram({ host, rootNames: ["/file.tspp"], options: { noLib: true, strict: true, tsppFeatures } });
    return program.getSemanticDiagnostics().map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  }

  it("evaluates basic identity and tuple type lambdas with =>>", () => {
    const messages = lambdaMessages(`
      type Id = <T> =>> T;
      type Pair = <A, B> =>> [A, B];
      const a: Id<number> = 1;
      const b: Pair<string, number> = ["hello", 42];
      const badA: Id<number> = "x";
      const badB: Pair<string, number> = [42, "hello"];
    `);
    assert.lengthOf(messages, 3, messages.join("\n"));
    assert.match(messages[0], /not assignable/);
    assert.match(messages[1], /not assignable/);
  });

  it("passes type lambda as higher-kinded argument", () => {
    const messages = lambdaMessages(`
      type Apply<F: Type => Type, X> = F<X>;
      type R = Apply<<T> =>> [T], number>;
      const ok: R = [123];
      const bad: R = 123;
    `);
    assert.lengthOf(messages, 1, messages.join("\n"));
    assert.match(messages[0], /not assignable/);
  });

  it("supports combinators with higher-order type lambdas", () => {
    const messages = lambdaMessages(`
      type Swap<F: (Type, Type) => Type> = <A, B> =>> F<B, A>;
      type SwappedTuple = Swap<<A, B> =>> [A, B]>;
      const ok: SwappedTuple<string, number> = [42, "hello"];
      const bad: SwappedTuple<string, number> = ["hello", 42];
    `);
    assert.lengthOf(messages, 2, messages.join("\n"));
    assert.match(messages[0], /not assignable/);
  });

  it("captures outer type parameters in closure", () => {
    const messages = lambdaMessages(`
      type Const<X> = <T> =>> X;
      type NumConst = Const<number>;
      const ok: NumConst<string> = 42;
      const bad: NumConst<string> = "hello";
    `);
    assert.lengthOf(messages, 1, messages.join("\n"));
    assert.match(messages[0], /not assignable/);
  });

  it("enforces constraints on lambda type parameters", () => {
    const messages = lambdaMessages(`
      type OnlyString = <T extends string> =>> { str: T };
      type Ok = OnlyString<"hello">;
      type Bad = OnlyString<number>;
    `);
    assert.lengthOf(messages, 1, messages.join("\n"));
    assert.match(messages[0], /constraint/);
  });

  it("works with scoped let bindings and type lambdas", () => {
    const messages = lambdaMessages(`
      type T = let F = <A> =>> [A, A] in F<string>;
      const ok: T = ["a", "a"];
      const bad: T = ["a", 1];
    `);
    assert.lengthOf(messages, 1, messages.join("\n"));
    assert.match(messages[0], /not assignable/);
  });

  it("supports curried type lambdas", () => {
    const messages = lambdaMessages(`
      type Curried = <A> =>> <B> =>> [A, B];
      type Step1 = Curried<number>;
      const ok: Step1<string> = [1, "two"];
      const bad: Step1<string> = ["two", 1];
    `);
    assert.lengthOf(messages, 2, messages.join("\n"));
    assert.match(messages[0], /not assignable/);
  });

  it("instantiates object literal bodies in type lambdas", () => {
    const messages = lambdaMessages(`
      type Box = <T> =>> { readonly value: T };
      type BoxedNum = Box<number>;
      const ok: BoxedNum = { value: 123 };
      const bad: BoxedNum = { value: "x" };
    `);
    assert.lengthOf(messages, 1, messages.join("\n"));
    assert.match(messages[0], /not assignable/);
  });

  it("is preserved in declaration emit with =>>", () => {
    const host = new fakes.CompilerHost(vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument("/file.tspp", "export type Box = <T> =>> { box: T };")], cwd: "/" },
    ));
    const program = ts.createProgram({ host, rootNames: ["/file.tspp"], options: { noLib: true, strict: true, declaration: true, emitDeclarationOnly: true, tsppFeatures: ["typeComputation"] } });
    let output = "";
    program.emit(/*targetSourceFile*/ undefined, (_name, text) => output += text);
    assert.include(output, "<T> =>> {", output);
    assert.include(output, "box: T", output);
  });

  it("requires typeComputation to be enabled", () => {
    const messages = lambdaMessages(
      `
      type Id = <T> =>> T;
      `,
      [],
    );
    assert.match(messages.join("\n"), /typeComputation/);
  });

  it("displays explicit Type0 kind on hover when typeUniverses is enabled", () => {
    const source = `
      type Id<A> = A;
      type Id1<B: Type1> = B;
      type Compose<F: Type => Type, G: Type => Type> = F;
      type Lam = <T> =>> T;
    `;
    const ls = ts.createLanguageService({
      getScriptFileNames: () => ["/file.tspp"],
      getScriptVersion: () => "1",
      getScriptSnapshot: f => f === "/file.tspp" ? ts.ScriptSnapshot.fromString(source) : undefined,
      getCurrentDirectory: () => "/",
      getCompilationSettings: () => ({ noLib: true, strict: true, tsppFeatures: ["typeUniverses", "typeComputation"] }),
      getDefaultLibFileName: () => "/lib.d.ts",
      fileExists: f => f === "/file.tspp",
      readFile: f => f === "/file.tspp" ? source : undefined,
    });
    const posA = source.indexOf("<A>") + 1;
    const infoA = ls.getQuickInfoAtPosition("/file.tspp", posA);
    assert.equal(ts.displayPartsToString(infoA?.displayParts), "(type parameter) A in type Id<A: Type0>");

    const posB = source.indexOf("<B") + 1;
    const infoB = ls.getQuickInfoAtPosition("/file.tspp", posB);
    assert.equal(ts.displayPartsToString(infoB?.displayParts), "(type parameter) B in type Id1<B: Type1>");

    const posF = source.indexOf("<F") + 1;
    const infoF = ls.getQuickInfoAtPosition("/file.tspp", posF);
    assert.equal(ts.displayPartsToString(infoF?.displayParts), "(type parameter) F in type Compose<F: Type0 => Type0, G: Type0 => Type0>");

    const posT = source.indexOf("<T>") + 1;
    const infoT = ls.getQuickInfoAtPosition("/file.tspp", posT);
    assert.equal(ts.displayPartsToString(infoT?.displayParts), "(type parameter) T in <T: Type0> =>>");
  });
});

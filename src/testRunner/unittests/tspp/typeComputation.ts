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
  function matchMessages(content: string) {
    const host = new fakes.CompilerHost(vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument("/file.tspp", content)], cwd: "/" },
    ));
    const program = ts.createProgram({ host, rootNames: ["/file.tspp"], options: { noLib: true, strict: true, tsppFeatures: ["typeComputation"] } });
    return program.getSemanticDiagnostics().map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  }

  it("matches literal types in order", () => {
    const messages = matchMessages(`
      type Name<T> = match T { 1 => "one", 2 => "two", _ => "many" };
      const a: Name<1> = "one";
      const b: Name<2> = "two";
      const c: Name<7> = "many";
      const bad: Name<1> = "two";
    `);
    assert.lengthOf(messages, 1, messages.join("\\n"));
    assert.match(messages[0], /not assignable/);
  });

  it("captures structural members with infer and does not distribute", () => {
    const messages = matchMessages(`
      type Value<T> = match T { { value: infer U } => U, _ => never };
      const ok: Value<{ value: 1 }> = 1;
      const bad: Value<{ value: 1 }> = 2;
    `);
    assert.lengthOf(messages, 1, messages.join("\\n"));
    assert.match(messages[0], /not assignable/);
  });
});

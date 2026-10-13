import * as documents from "../../_namespaces/documents.js";
import * as fakes from "../../_namespaces/fakes.js";
import * as Harness from "../../_namespaces/Harness.js";
import * as ts from "../../_namespaces/ts.js";
import * as vfs from "../../_namespaces/vfs.js";

describe("unittests:: tspp:: newtype and data", () => {
  function createProgram(fileName: string, content: string, options: ts.CompilerOptions = {}) {
    const host = new fakes.CompilerHost(vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument(fileName, content)], cwd: "/" },
    ));
    return ts.createProgram({ host, rootNames: [fileName], options: { noLib: true, strict: true, ...options } });
  }

  function semanticMessages(program: ts.Program) {
    return program.getSemanticDiagnostics().map(diagnostic => diagnostic.messageText.toString());
  }

  describe("newtype", () => {
    it("is assignable to its underlying type but not vice versa", () => {
      const program = createProgram(
        "/file.ts",
        `
        newtype UserId = number;
        declare const userId: UserId;
        const ok: number = userId;
        const bad: UserId = 1;
      `,
      );
      const checker = program.getTypeChecker();
      const file = program.getSourceFile("/file.ts")!;
      const declarations = file.statements.filter(ts.isVariableStatement)
        .flatMap(statement => [...statement.declarationList.declarations]);

      const userType = checker.getTypeAtLocation(declarations[0].name);
      const numberType = checker.getTypeAtLocation(declarations[0].type!);
      assert.isTrue(checker.isTypeAssignableTo(userType, numberType));
      assert.isFalse(checker.isTypeAssignableTo(numberType, userType));

      const messages = semanticMessages(program);
      assert.lengthOf(messages, 1, messages.join("\n"));
      assert.match(messages[0], /not assignable/);
    });

    it("keeps distinct newtypes nominal even with identical underlying types", () => {
      const program = createProgram(
        "/file.ts",
        `
        newtype UserId = number;
        newtype OrderId = number;
        declare const userId: UserId;
        const bad: OrderId = userId;
      `,
      );
      assert.lengthOf(semanticMessages(program), 1);
    });

    it("gives the constructor the identity signature over the underlying type", () => {
      const program = createProgram(
        "/file.ts",
        `
        newtype UserId = number;
        const created: UserId = UserId(42);
      `,
      );
      assert.isEmpty(semanticMessages(program));

      const checker = program.getTypeChecker();
      const file = program.getSourceFile("/file.ts")!;
      const declaration = file.statements.filter(ts.isVariableStatement)
        .flatMap(statement => [...statement.declarationList.declarations])[0];
      assert.strictEqual(checker.typeToString(checker.getTypeAtLocation(declaration.name)), "UserId");
    });
  });

  describe("data", () => {
    it("forms a union of its variants and enforces field types", () => {
      const program = createProgram(
        "/file.ts",
        `
        data Option<T> = None | Some(value: T);
        const none: Option<number> = None;
        const some: Option<number> = Some(1);
        const bad: Option<number> = Some("x");
      `,
      );
      const messages = semanticMessages(program);
      assert.lengthOf(messages, 1, messages.join("\n"));
      assert.match(messages[0], /not assignable/);
    });

    it("exposes the _tag discriminant and variant fields", () => {
      const program = createProgram(
        "/file.ts",
        `
        data Option<T> = None | Some(value: T);
        declare const opt: Option<number>;
        const tag: "None" = (opt === None) ? opt._tag : None._tag;
      `,
      );
      assert.isEmpty(semanticMessages(program));
    });

    it("only gives a variant the type parameters it mentions", () => {
      const program = createProgram(
        "/file.ts",
        `
        data Either<L, R> = Left(value: L) | Right(value: R) | Empty;
        declare const left: Left<number>;
        const l: number = left.value;
      `,
      );
      assert.isEmpty(semanticMessages(program));
    });
  });
});

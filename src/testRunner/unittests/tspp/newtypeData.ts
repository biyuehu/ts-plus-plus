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
    return ts.createProgram({ host, rootNames: [fileName], options: { noLib: true, strict: true, tsppFeatures: ["newtypeDeclarations", "dataDeclarations"], ...options } });
  }

  function semanticMessages(program: ts.Program) {
    return program.getSemanticDiagnostics().map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  }

  describe("newtype", () => {
    it("is assignable to its underlying type but not vice versa", () => {
      const program = createProgram(
        "/file.tspp",
        `
        newtype UserId = number;
        declare const userId: UserId;
        const ok: number = userId;
        const bad: UserId = 1;
      `,
      );
      const checker = program.getTypeChecker();
      const file = program.getSourceFiles().find(f => f.fileName.endsWith(".tspp"))!;
      const declarations = file.statements.filter(ts.isVariableStatement)
        .flatMap(statement => [...statement.declarationList.declarations]);

      const userType = checker.getTypeAtLocation(declarations[0].name);
      const numberType = checker.getTypeAtLocation(file.statements.find(ts.isNewtypeDeclaration)!.type);
      assert.isTrue(checker.isTypeAssignableTo(userType, numberType));
      assert.isFalse(checker.isTypeAssignableTo(numberType, userType));

      const messages = semanticMessages(program);
      assert.lengthOf(messages, 1, messages.join("\n"));
      assert.match(messages[0], /not assignable/);
    });

    it("keeps distinct newtypes nominal even with identical underlying types", () => {
      const program = createProgram(
        "/file.tspp",
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
        "/file.tspp",
        `
        newtype UserId = number;
        const created: UserId = UserId(42);
      `,
      );
      assert.isEmpty(semanticMessages(program));

      const checker = program.getTypeChecker();
      const file = program.getSourceFiles().find(f => f.fileName.endsWith(".tspp"))!;
      const declaration = file.statements.filter(ts.isVariableStatement)
        .flatMap(statement => [...statement.declarationList.declarations])[0];
      assert.strictEqual(checker.typeToString(checker.getTypeAtLocation(declaration.name)), "UserId");
    });
  });

  describe("data", () => {
    it("forms a union of its variants and enforces field types", () => {
      const program = createProgram(
        "/file.tspp",
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
        "/file.tspp",
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
        "/file.tspp",
        `
        data Either<L, R> = Left(value: L) | Right(value: R) | Empty;
        declare const left: Left<number>;
        const l: number = left.value;
      `,
      );
      assert.isEmpty(semanticMessages(program));
    });

    it("rejects a variant field of the wrong type", () => {
      const program = createProgram(
        "/file.tspp",
        `
        data Either<L, R> = Left(value: L) | Right(value: R) | Empty;
        declare const left: Left<string>;
        const n: number = left.value;
      `,
      );
      const messages = semanticMessages(program);
      assert.lengthOf(messages, 1, messages.join("\n"));
      assert.match(messages[0], /not assignable/);
    });

    it("distinguishes variants by their _tag", () => {
      const program = createProgram(
        "/file.tspp",
        `
        data Option<T> = None | Some(value: T);
        declare const opt: Option<number>;
        const bad: "Some" = (opt === None) ? opt._tag : None._tag;
      `,
      );
      const messages = semanticMessages(program);
      assert.lengthOf(messages, 1, messages.join("\n"));
      assert.match(messages[0], /not assignable/);
    });

    it("rejects a variant applied to a mismatched type argument", () => {
      const program = createProgram(
        "/file.tspp",
        `
        data Either<L, R> = Left(value: L) | Right(value: R) | Empty;
        declare const left: Left<number, string>;
        const l: number = left.value;
      `,
      );
      assert.isNotEmpty(semanticMessages(program));
    });

    it("supports a recursive data type", () => {
      const program = createProgram(
        "/file.tspp",
        `
        data List<T> = Nil | Cons(head: T, tail: List<T>);
        declare const list: List<number>;
        declare const cons: Cons<number>;
        const n: number = cons.head;
        const t: List<number> = cons.tail;
        const ok: List<number> = Nil;
      `,
      );
      const messages = semanticMessages(program);
      assert.isEmpty(messages, messages.join("\n"));
    });

    it("rejects the empty variant pattern access on a union", () => {
      const program = createProgram(
        "/file.tspp",
        `
        data Option<T> = None | Some(value: T);
        declare const opt: Option<number>;
        const n: number = opt.value;
      `,
      );
      assert.isNotEmpty(semanticMessages(program));
    });
  });

  describe("newtype", () => {
    it("supports a generic newtype", () => {
      const program = createProgram(
        "/file.tspp",
        `
        newtype Box<T> = T;
        declare const box: Box<number>;
        const n: number = box;
        const bad: Box<number> = 1;
      `,
      );
      const messages = semanticMessages(program);
      assert.lengthOf(messages, 1, messages.join("\n"));
      assert.match(messages[0], /not assignable/);
    });

    it("keeps distinct generic newtypes nominal", () => {
      const program = createProgram(
        "/file.tspp",
        `
        newtype A<T> = T;
        newtype B<T> = T;
        declare const a: A<number>;
        const bad: B<number> = a;
      `,
      );
      assert.lengthOf(semanticMessages(program), 1);
    });

    it("gives a generic newtype constructor the identity signature", () => {
      const program = createProgram(
        "/file.tspp",
        `
        newtype Box<T> = T;
        const box: Box<number> = Box(42);
      `,
      );
      assert.isEmpty(semanticMessages(program));
    });

    it("keeps a newtype nominal when the underlying type is an object", () => {
      const program = createProgram(
        "/file.tspp",
        `
        newtype Point = { x: number; y: number };
        declare const p: Point;
        const obj: { x: number; y: number } = p;
        const bad: Point = { x: 1, y: 2 };
      `,
      );
      const messages = semanticMessages(program);
      assert.lengthOf(messages, 1, messages.join("\n"));
      assert.match(messages[0], /not assignable/);
    });

    it("does not expose the nominal brand in keyof", () => {
      const program = createProgram(
        "/file.tspp",
        `
        newtype Point = { x: number; y: number };
        declare const k: keyof Point;
        const ok: "x" | "y" = k;
        const bad: keyof Point = "z";
      `,
      );
      const messages = semanticMessages(program);
      assert.lengthOf(messages, 1, messages.join("\n"));
      assert.match(messages[0], /not assignable/);
    });

    it("keeps a newtype nominal when the underlying type is a union", () => {
      const program = createProgram(
        "/file.tspp",
        `
        newtype StringOrNumber = string | number;
        declare const v: StringOrNumber;
        const s: string | number = v;
        const bad: StringOrNumber = "x";
      `,
      );
      const messages = semanticMessages(program);
      assert.lengthOf(messages, 1, messages.join("\n"));
      assert.match(messages[0], /not assignable/);
    });

    it("requires newtypeDeclarations to be enabled", () => {
      const program = createProgram(
        "/file.tspp",
        `
        newtype UserId = number;
      `,
        { tsppFeatures: [] },
      );
      const messages = semanticMessages(program);
      assert.isNotEmpty(messages, messages.join("\n"));
      assert.match(messages.join("\n"), /newtypeDeclarations/);
    });

    it("requires dataDeclarations to be enabled", () => {
      const program = createProgram(
        "/file.tspp",
        `
        data Option<T> = None | Some(value: T);
      `,
        { tsppFeatures: [] },
      );
      const messages = semanticMessages(program);
      assert.isNotEmpty(messages, messages.join("\n"));
      assert.match(messages.join("\n"), /dataDeclarations/);
    });

    it("does not expose the nominal brand in hover", () => {
      const content = `
        newtype UserId = number;
        declare const userId: UserId;
      `;
      const adapter = new Harness.LanguageService.NativeLanguageServiceAdapter(/*cancellationToken*/ undefined, { noLib: true, strict: true, tsppFeatures: ["newtypeDeclarations", "dataDeclarations"] });
      const host = adapter.getHost();
      host.addScript("file.tspp", content, /*isRootFile*/ true);
      const service = adapter.getLanguageService();
      const info = service.getQuickInfoAtPosition("file.tspp", content.lastIndexOf("userId"));
      assert.isDefined(info);
      const text = ts.displayPartsToString(info!.displayParts);
      assert.include(text, "UserId", text);
      assert.notInclude(text, "__@nominal@", text);
    });
  });
});

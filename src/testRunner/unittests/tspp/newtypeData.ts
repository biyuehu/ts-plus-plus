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

  function emitDeclarations(content: string, extraFeatures?: readonly string[]) {
    const fileName = "/file.tspp";
    const options: ts.CompilerOptions = {
      declaration: true,
      emitDeclarationOnly: true,
      noLib: true,
      strict: true,
      tsppFeatures: ["newtypeDeclarations", "dataDeclarations", ...(extraFeatures ?? [])],
    };
    const fs = vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument(fileName, content)], cwd: "/" },
    );
    const host = new fakes.CompilerHost(fs, options);
    const program = ts.createProgram({ host, rootNames: [fileName], options });
    const result = program.emit();
    assert.isFalse(result.emitSkipped, result.diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
    return fs.readFileSync("/file.d.tspp").toString();
  }

  describe("emit", () => {
    it("lowers newtype and data constructors to JavaScript", () => {
      const output = ts.transpileModule(
        `
        newtype UserId = number;
        data Option<T> = None | Some(value: T);
        const values = [UserId(1), Some(2), None];
        `,
        {
          fileName: "file.tspp",
          compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            tsppFeatures: ["newtypeDeclarations", "dataDeclarations"],
          },
        },
      ).outputText;

      assert.include(output, "function UserId(value)");
      assert.include(output, 'const None = { _tag: "None" };');
      assert.include(output, "function Some(value)");
      assert.include(output, 'return { _tag: "Some", value };');
    });

    it("preserves newtype and data declarations in declaration output", () => {
      const output = emitDeclarations(`
        export newtype UserId = number;
        export data Option<T> = None | Some(value: T);
      `);

      assert.include(output, "export newtype UserId = number;");
      assert.include(output, "export data Option<T> = None | Some(value: T);");
    });

    it("preserves kind annotations in declaration output", () => {
      const output = emitDeclarations(
        `
        export newtype Box<T>: Type = T[];
        export data Option<T>: Type = None | Some(value: T);
      `,
        ["higherKindedTypes"],
      );

      assert.include(output, "export newtype Box<T>: Type = T[];");
      assert.include(output, "export data Option<T>: Type = None | Some(value: T);");
    });
  });

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

    it("supports @ts-expect-error for newtype and data diagnostics", () => {
      const program = createProgram(
        "/expected-errors.tspp",
        `
        newtype UserId = number;
        newtype OrderId = number;
        declare const userId: UserId;
        // @ts-expect-error -- a plain number is not a UserId
        const badNumber: UserId = 1;
        // @ts-expect-error -- distinct newtypes are nominal
        const badOrder: OrderId = userId;

        data Option<T> = None | Some(value: T);
        // @ts-expect-error -- the variant field has the wrong type
        const badOption: Option<number> = Some("x");
        // @ts-expect-error -- structural lookalikes do not carry the variant brand
        const badVariant: typeof None = { _tag: "None" as const };
      `,
      );

      assert.isEmpty(program.getSemanticDiagnostics());
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

    it("supports kind annotations on newtype declarations", () => {
      const program = createProgram(
        "/file.tspp",
        `
        type Apply<F: Type => Type, A> = F<A>;
        newtype Box<T>: Type = T[];
        type Applied = Apply<Box, number>;
      `,
        { tsppFeatures: ["newtypeDeclarations", "dataDeclarations", "higherKindedTypes"] },
      );
      assert.isEmpty(semanticMessages(program));
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
      const checker = program.getTypeChecker();
      const file = program.getSourceFiles().find(f => f.fileName.endsWith(".tspp"))!;
      const decls = file.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]);
      const someSym = checker.getSymbolAtLocation((decls[1].initializer as ts.CallExpression).expression);
      const someType = checker.typeToString(checker.getTypeAtLocation(decls[1].initializer!));
      const badType = checker.typeToString(checker.getTypeAtLocation(decls[2].initializer!));
      const ctor = someSym ? checker.getTypeOfSymbolAtLocation(someSym, decls[1].initializer!) : undefined;
      const ctorType = ctor ? checker.typeToString(ctor) : "(nosym)";
      const sigs = ctor ? checker.getSignaturesOfType(ctor, ts.SignatureKind.Call) : [];
      const ret = sigs.length ? checker.typeToString(sigs[0].getReturnType()) : "(nosig)";
      const callType = checker.typeToString(checker.getTypeAtLocation(decls[1].initializer!));
      const messages = semanticMessages(program);
      assert.lengthOf(messages, 1, `ctor=${ctorType} sigs=${sigs.length} ret=${ret} call=${callType} some=${someType} bad=${badType} :: ${messages.join("\n") || "(no messages)"}`);
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

    it("does not allow a variant to be used as a type", () => {
      const program = createProgram(
        "/file.tspp",
        `
        data List<T> = Nil | Cons(head: T, tail: List<T>);
        declare const a: Nil;
        type X = Nil;
      `,
      );
      const messages = semanticMessages(program);
      assert.lengthOf(messages, 2, messages.join("\n"));
      assert.match(messages.join("\n"), /refers to a value/);
    });

    it("lets typeof reach the variant type of a constant variant", () => {
      const program = createProgram(
        "/file.tspp",
        `
        data List<T> = Nil | Cons(head: T, tail: List<T>);
        const nil: typeof Nil = Nil;
        const list: List<number> = nil;
      `,
      );
      const messages = semanticMessages(program);
      assert.isEmpty(messages, messages.join("\n"));
    });

    it("rejects a variant field of the wrong type", () => {
      const program = createProgram(
        "/file.tspp",
        `
        data Either<L, R> = Left(value: L) | Right(value: R) | Empty;
        declare const either: Either<string, number>;
        const n: number = either._tag === "Left" ? either.value : 0;
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

    it("rejects a variant constructed with a mismatched type argument", () => {
      const program = createProgram(
        "/file.tspp",
        `
        data Either<L, R> = Left(value: L) | Right(value: R) | Empty;
        const bad: Either<number, string> = Left("x");
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
        const n: number = list._tag === "Cons" ? list.head : 0;
        const t: List<number> = list._tag === "Cons" ? list.tail : Nil;
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

    it("supports kind annotations on data declarations", () => {
      const program = createProgram(
        "/file.tspp",
        `
        type Apply<F: Type => Type, A> = F<A>;
        data Option<T>: Type = None | Some(value: T);
        type Applied = Apply<Option, number>;
      `,
        { tsppFeatures: ["newtypeDeclarations", "dataDeclarations", "higherKindedTypes"] },
      );
      assert.isEmpty(semanticMessages(program));
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
      const text = ts.displayPartsToString(info.displayParts);
      assert.include(text, "UserId", text);
      assert.notInclude(text, "__@nominal@", text);
    });

    it("displays kindType and formatted variants in hover", () => {
      const content = `
        newtype Box<T>: Type = T;
        data Option<T>: Type = None | Some(value: T);
      `;
      const adapter = new Harness.LanguageService.NativeLanguageServiceAdapter(/*cancellationToken*/ undefined, {
        noLib: true,
        strict: true,
        tsppFeatures: ["newtypeDeclarations", "dataDeclarations", "higherKindedTypes"],
      });
      const host = adapter.getHost();
      host.addScript("file.tspp", content, /*isRootFile*/ true);
      const service = adapter.getLanguageService();

      const boxInfo = service.getQuickInfoAtPosition("file.tspp", content.indexOf("Box"));
      assert.isDefined(boxInfo);
      const boxText = ts.displayPartsToString(boxInfo.displayParts);
      assert.include(boxText, "newtype Box<T>: Type = T");

      const optInfo = service.getQuickInfoAtPosition("file.tspp", content.indexOf("Option"));
      assert.isDefined(optInfo);
      const optText = ts.displayPartsToString(optInfo.displayParts);
      assert.include(optText, "data Option<T>: Type = None | Some(value: T)");
    });

    it("rejects underlying types that erase the nominal brand", () => {
      const program = createProgram(
        "/file.tspp",
        `
        newtype AnyValue = any;
        newtype UnknownValue = unknown;
        newtype NeverValue = never;
      `,
      );
      const messages = semanticMessages(program);
      assert.lengthOf(messages, 3, messages.join("\n"));
      assert.isTrue(messages.every(message => /cannot use 'any', 'unknown', or 'never'/.test(message)), messages.join("\n"));
    });
  });

  describe("data variant fields", () => {
    it("rejects unsupported parameter forms", () => {
      const program = createProgram(
        "/file.tspp",
        `
        data Invalid =
          MissingType(value)
          | Optional(value?: number)
          | Defaulted(value: number = 1)
          | Rest(...values: number[])
          | Destructured({ value }: { value: number });
      `,
      );
      const messages = semanticMessages(program);
      assert.lengthOf(messages, 5, messages.join("\n"));
      assert.isTrue(messages.every(message => /must be a required identifier with a type annotation/.test(message)), messages.join("\n"));
    });
  });
});

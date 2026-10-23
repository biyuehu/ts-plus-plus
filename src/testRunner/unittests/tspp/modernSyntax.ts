import * as documents from "../../_namespaces/documents.js";
import * as fakes from "../../_namespaces/fakes.js";
import * as Harness from "../../_namespaces/Harness.js";
import * as ts from "../../_namespaces/ts.js";
import * as vfs from "../../_namespaces/vfs.js";

describe("unittests:: tspp:: modernSyntax", () => {
  function createProgram(fileName: string, content: string, options: ts.CompilerOptions = {}) {
    const host = new fakes.CompilerHost(vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument(fileName, content)], cwd: "/" },
    ));
    return ts.createProgram({ host, rootNames: [fileName], options: { noLib: true, strict: true, tsppFeatures: ["modernSyntax"], ...options } });
  }

  function semanticMessages(program: ts.Program) {
    return program.getSemanticDiagnostics().map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  }

  function emitOutput(program: ts.Program, _fileName: string) {
    let emitted = "";
    program.emit(/*targetSourceFile*/ undefined, (outputName, text) => {
      if (outputName.endsWith(".js")) {
        emitted += text;
      }
    });
    return emitted;
  }

  it("requires modernSyntax feature flag for let-in expression", () => {
    const disabledProgram = createProgram("/src/main.ts", `const a = let x = 1 in 100;`, { tsppFeatures: [] });
    assert.deepEqual(semanticMessages(disabledProgram), [
      "TS++ feature 'modernSyntax' is not enabled in 'tsppconfig.json'.",
    ]);

    const enabledProgram = createProgram("/src/main.ts", `const a = let x = 1 in 100;`);
    assert.deepEqual(semanticMessages(enabledProgram), []);
  });

  it("requires modernSyntax feature flag for do expression", () => {
    const disabledProgram = createProgram("/src/main.ts", `const a = do { 42; };`, { tsppFeatures: [] });
    assert.deepEqual(semanticMessages(disabledProgram), [
      "TS++ feature 'modernSyntax' is not enabled in 'tsppconfig.json'.",
    ]);

    const enabledProgram = createProgram("/src/main.ts", `const a = do { 42; };`);
    assert.deepEqual(semanticMessages(enabledProgram), []);
  });

  it("requires modernSyntax feature flag for do function", () => {
    const disabledProgram = createProgram("/src/main.ts", `function f(): number do { 42; }`, { tsppFeatures: [] });
    assert.deepEqual(semanticMessages(disabledProgram), [
      "TS++ feature 'modernSyntax' is not enabled in 'tsppconfig.json'.",
    ]);

    const enabledProgram = createProgram("/src/main.ts", `function f(): number do { 42; }`);
    assert.deepEqual(semanticMessages(enabledProgram), []);
  });

  it("infers types for let-in and emits IIFE correctly", () => {
    const program = createProgram(
      "/src/main.ts",
      `
      declare function takesNumber(n: number): void;
      const res = let x = 10, y = 20 in x + y;
      takesNumber(res);
    `,
    );
    assert.deepEqual(semanticMessages(program), []);

    const js = emitOutput(program, "/src/main.ts");
    assert.isTrue(js.includes("let x = 10, y = 20;"));
    assert.isTrue(js.includes("return x + y;"));
  });

  it("infers types for do expression and emits IIFE correctly", () => {
    const program = createProgram(
      "/src/main.ts",
      `
      declare function takesString(s: string): void;
      const res = do {
        const hello = "world";
        hello;
      };
      takesString(res);
    `,
    );
    assert.deepEqual(semanticMessages(program), []);

    const js = emitOutput(program, "/src/main.ts");
    assert.isTrue(js.includes('const hello = "world";'));
    assert.isTrue(js.includes("return hello;"));
  });

  it("handles do function with implicit return and keeps standard functions untouched", () => {
    const program = createProgram(
      "/src/main.ts",
      `
      declare function takesNumber(n: number): void;
      declare function takesVoid(v: void): void;

      function doFunc(): number do {
        const x = 5;
        x + 10;
      }

      function normalFunc(): void {
        const y = 5;
        y + 10;
      }

      class Service {
        compute(): number do {
          100;
        }
      }

      takesNumber(doFunc());
      takesVoid(normalFunc());
      takesNumber(new Service().compute());
    `,
    );
    assert.deepEqual(semanticMessages(program), []);

    const js = emitOutput(program, "/src/main.ts");
    // doFunc should have return x + 10;
    assert.isTrue(js.includes("return x + 10;"));
    // normalFunc should NOT have return y + 10;
    assert.isFalse(js.includes("return y + 10;"));
    // Service compute should have return 100;
    assert.isTrue(js.includes("return 100;"));
  });

  it("supports if-branch implicit return in do expression", () => {
    const program = createProgram(
      "/src/main.ts",
      `
      declare const cond: boolean;
      declare function takesNumber(n: number): void;
      const val = do {
        if (cond) {
          1;
        } else {
          2;
        }
      };
      takesNumber(val);
    `,
    );
    assert.deepEqual(semanticMessages(program), []);

    const js = emitOutput(program, "/src/main.ts");
    assert.isTrue(js.includes("return 1;"));
    assert.isTrue(js.includes("return 2;"));
  });
  it("reports error when do function completion type does not match return type annotation", () => {
    const program = createProgram(
      "/src/main.ts",
      `
      function calculateDiscount(price: number, isVip: boolean): number do {
        "";
      }
    `,
    );
    assert.deepEqual(semanticMessages(program), [
      "Type 'string' is not assignable to type 'number'.",
    ]);
  });

  it("reports error when variable in let-in expression lacks initializer", () => {
    const program = createProgram(
      "/src/main.ts",
      `
      let y = let x in x;
    `,
    );
    assert.deepEqual(semanticMessages(program), [
      "'let' declarations must be initialized.",
    ]);
  });

  it("requires modernSyntax feature flag for use binding", () => {
    const enabledProgram = createProgram(
      "/src/main.ts",
      `
      declare function withRes<T>(cb: (x: number) => T): T;
      function f() do {
        use x <- withRes();
        x + 1;
      }
      `,
    );
    assert.deepEqual(semanticMessages(enabledProgram), []);

    const disabledProgram = createProgram(
      "/src/main.ts",
      `
      declare function withRes<T>(cb: (x: number) => T): T;
      function f() do {
        use x <- withRes();
        x + 1;
      }
      `,
      { tsppFeatures: [] },
    );
    assert.deepEqual(semanticMessages(disabledProgram), [
      "TS++ feature 'modernSyntax' is not enabled in 'tsppconfig.json'.",
      "TS++ feature 'modernSyntax' is not enabled in 'tsppconfig.json'.",
    ]);
  });

  it("reports error when use binding is placed outside do context", () => {
    const program = createProgram(
      "/src/main.ts",
      `
      declare function withRes<T>(cb: (x: number) => T): T;
      function normalBlock() {
        use x <- withRes();
        x + 1;
      }
      `,
    );
    assert.deepEqual(semanticMessages(program), [
      "Invalid MLTT type: A 'use <-' binding is only allowed directly inside a 'do' block or 'do' function.",
    ]);
  });

  it("desugars use binding in do expression and infers types", () => {
    const program = createProgram(
      "/src/main.ts",
      `
      declare function withResource<T>(fn: (res: string) => T): T;
      declare function takesString(s: string): void;
      const val = do {
        use r <- withResource();
        takesString(r);
        r;
      };
      takesString(val);
      `,
    );
    assert.deepEqual(semanticMessages(program), []);

    const js = emitOutput(program, "/src/main.ts");
    assert.isTrue(js.includes("return withResource(r => {"));
    assert.isTrue(js.includes("return r;"));
  });

  it("desugars chained use bindings in do function", () => {
    const program = createProgram(
      "/src/main.ts",
      `
      declare function withA<T>(fn: (a: number) => T): T;
      declare function withB<T>(fn: (b: string) => T): T;
      declare function takesString(s: string): void;

      function run(): string do {
        use a <- withA();
        use b <- withB();
        b + a;
      }

      takesString(run());
      `,
    );
    assert.deepEqual(semanticMessages(program), []);

    const js = emitOutput(program, "/src/main.ts");
    assert.isTrue(js.includes("return withA(a => {"));
    assert.isTrue(js.includes("return withB(b => {"));
    assert.isTrue(js.includes("return b + a;"));
  });

  it("supports destructuring in use binding", () => {
    const program = createProgram(
      "/src/main.ts",
      `
      declare function withPair<T>(fn: (pair: [number, string]) => T): T;
      declare function takesNumber(n: number): void;
      declare function takesString(s: string): void;

      const res = do {
        use [num, str] <- withPair();
        takesNumber(num);
        takesString(str);
        num;
      };
      takesNumber(res);
      `,
    );
    assert.deepEqual(semanticMessages(program), []);

    const js = emitOutput(program, "/src/main.ts");
    assert.isTrue(js.includes("return withPair(([num, str]) => {"));
    assert.isTrue(js.includes("return num;"));
  });

  it("supports language service quickInfo and completions for use bindings", () => {
    const source = `
      declare function withResource<T>(fn: (res: string) => T): T;
      const val = do {
        use r <- withResource();
        r;
      };
    `;
    const fileName = "/src/main.ts";
    const ls = ts.createLanguageService({
      getScriptFileNames: () => [fileName],
      getScriptVersion: () => "1",
      getScriptSnapshot: f => f === fileName ? ts.ScriptSnapshot.fromString(source) : undefined,
      getCurrentDirectory: () => "/",
      getCompilationSettings: () => ({ noLib: true, strict: true, tsppFeatures: ["modernSyntax"] }),
      getDefaultLibFileName: () => "/lib.d.ts",
      fileExists: f => f === fileName,
      readFile: f => f === fileName ? source : undefined,
    });
    const declPos = source.indexOf("use r") + 4;
    const quickInfo = ls.getQuickInfoAtPosition(fileName, declPos);
    assert.isDefined(quickInfo);
    assert.strictEqual(quickInfo.kind, "var");
    assert.isTrue(quickInfo.displayParts?.some(part => part.text === "string"));

    const completions = ls.getCompletionsAtPosition(fileName, source.indexOf("r;"), {});
    assert.isDefined(completions);
    assert.isTrue(completions.entries.some(entry => entry.name === "r"));
  });

  it("type-checks trailing closure return type and block completion type in use bindings", () => {
    const errorProgram = createProgram(
      "/src/main.ts",
      `
      declare function withResource<T>(fn: (res: { name: string; close: () => void }) => T): T;
      declare function withAuth<T>(role: string, fn: (token: string) => T): T;
      declare function withPair<T>(fn: (pair: [number, string]) => T): T;

      function runPipeline(): string do {
        use token <- withAuth("admin");
        use [code, status] <- withPair();
        use res <- withResource<number>();
        \`\${res.name}: [\${code}] \${status} for \${token}\`;
      }
      `,
    );
    const messages = semanticMessages(errorProgram);
    assert.isTrue(messages.some(m => m.includes("Type 'string' is not assignable to type 'number'")));
    assert.isTrue(messages.some(m => m.includes("Type 'number' is not assignable to type 'string'")));

    const validProgram = createProgram(
      "/src/main.ts",
      `
      declare function withResource<T>(fn: (res: { name: string; close: () => void }) => T): T;
      declare function withAuth<T>(role: string, fn: (token: string) => T): T;
      declare function withPair<T>(fn: (pair: [number, string]) => T): T;

      function runPipeline(): string do {
        use token <- withAuth("admin");
        use [code, status] <- withPair();
        use res <- withResource();
        \`\${res.name}: [\${code}] \${status} for \${token}\`;
      }
      `,
    );
    assert.deepEqual(semanticMessages(validProgram), []);
  });
});

import * as documents from "../../_namespaces/documents.js";
import * as fakes from "../../_namespaces/fakes.js";
import * as Harness from "../../_namespaces/Harness.js";
import * as ts from "../../_namespaces/ts.js";
import * as vfs from "../../_namespaces/vfs.js";

describe("unittests:: tspp:: formal contracts", () => {
  async function createProgram(content: string, tsppFeatures: string[] = ["formalContracts"]) {
    const fileName = "/file.tspp";
    const options: ts.CompilerOptions = {
      noLib: true,
      noImplicitAny: false,
      target: ts.ScriptTarget.ES2022,
      tsppFeatures,
    };
    const fs = vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument(fileName, content)], cwd: "/" },
    );
    const host = new fakes.CompilerHost(fs, options);
    const program = await ts.createProgramAsync({ host, rootNames: [fileName], options });
    return { fileName, fs, program };
  }

  it("parses and prints while invariant clauses", () => {
    const file = ts.createSourceFile(
      "/file.tspp",
      "while (x < n) with { invariant: x >= 0n; invariant: x <= n; } { x += 1n; }",
      ts.ScriptTarget.Latest,
      /*setParentNodes*/ true,
    );
    assert.isEmpty(file.parseDiagnostics);
    const statement = file.statements[0] as ts.WhileStatement;
    assert.isTrue(ts.isWhileStatement(statement));
    assert.equal(statement.withClause?.properties.length, 2);
    assert.include(ts.createPrinter().printFile(file), "with { invariant: x >= 0n; invariant: x <= n; }");
  });

  it("proves contracts and both loop invariant obligations", async () => {
    const { fs, program } = await createProgram(`
      function sum(n: bigint) with {
        requires: n >= 0n;
        ensures: result === n;
      }: bigint {
        let x = 0n;
        while (x < n) with {
          invariant: x >= 0n;
          invariant: x <= n;
        } {
          x += 1n;
        }
        return x;
      }
    `);
    const artifacts = program.getVerificationArtifacts!();
    assert.lengthOf(artifacts, 5);
    assert.isTrue(artifacts.every(artifact => artifact.status === "proved"));
    assert.isTrue(artifacts.every(artifact => artifact.taskKind === "verification"));
    assert.isTrue(artifacts.every(artifact => artifact.outcome === "succeeded"));
    assert.equal(new Set(artifacts.map(artifact => artifact.taskId)).size, artifacts.length);
    assert.deepEqual(program.getAnalysisArtifacts!(), artifacts);
    assert.isTrue(artifacts.every(artifact => artifact.replayableSmtLib.includes("(check-sat)")));
    const sourceFile = program.getSourceFile("/file.tspp")!;
    assert.isTrue(artifacts.every(artifact => !sourceFile.text.slice(artifact.start, artifact.start + artifact.length).includes("\n")));
    assert.isEmpty(program.getSemanticDiagnostics());

    const emit = program.emit();
    assert.isFalse(emit.emitSkipped);
    const js = fs.readFileSync("/file.js").toString();
    assert.include(js, "while (x < n)");
    assert.notInclude(js, "invariant");
    assert.notInclude(js, "ensures");
  });

  it("reports a counterexample instead of accepting a false postcondition", async () => {
    const { fileName, program } = await createProgram(`
      function bad(x: bigint) with { ensures: result > x; }: bigint {
        return x;
      }
    `);
    const [artifact] = program.getVerificationArtifacts!();
    assert.equal(artifact.status, "failed");
    assert.include(artifact.message, "counterexample");
    assert.isString(artifact.model);
    assert.equal(artifact.counterexample, "x = 0");
    assert.equal(program.getSourceFile(fileName)!.text.slice(artifact.start, artifact.start + artifact.length), "result > x");
    const message = ts.flattenDiagnosticMessageText(program.getSemanticDiagnostics()[0].messageText, "\n");
    assert.include(message, "proof failed");
    assert.include(message, "Counterexample: x = 0");
  });

  it("maps a loop counterexample back to source variable names", async () => {
    const { program } = await createProgram(`
      function countTo(limit: bigint) with { ensures: result === limit; }: bigint {
        let current = 0n;
        while (current < limit) with {
          invariant: current >= 0n;
          invariant: current <= limit;
        } {
          current += 1n;
        }
        return current;
      }
    `);
    const artifact = program.getVerificationArtifacts!().find(candidate => candidate.status === "failed" && candidate.obligation === "invariant-initialization")!;
    assert.equal(artifact.counterexample, "limit = -1");
    assert.include(ts.flattenDiagnosticMessageText(program.getSemanticDiagnostics()[0].messageText, "\n"), "Counterexample: limit = -1");
  });

  it("rejects a direct call that violates a requires clause", async () => {
    const { fileName, program } = await createProgram(`
      function successor(value: bigint) with { requires: value >= 0n; }: bigint {
        return value + 1n;
      }
      successor(-5n);
    `);
    const [artifact] = program.getVerificationArtifacts!();
    assert.equal(artifact.kind, "call-precondition");
    assert.equal(artifact.obligation, "precondition");
    assert.equal(artifact.status, "failed");
    assert.equal(artifact.counterexample, "value = -5");
    assert.equal(program.getSourceFile(fileName)!.text.slice(artifact.start, artifact.start + artifact.length), "successor(-5n)");
    assert.include(ts.flattenDiagnosticMessageText(program.getSemanticDiagnostics()[0].messageText, "\n"), "Counterexample: value = -5");
  });

  it("proves requires clauses at direct call sites", async () => {
    const { program } = await createProgram(`
      function successor(value: bigint) with { requires: value >= 0n; }: bigint {
        return value + 1n;
      }
      successor(5n);
    `);
    const [artifact] = program.getVerificationArtifacts!();
    assert.equal(artifact.kind, "call-precondition");
    assert.equal(artifact.status, "proved");
    assert.isEmpty(program.getSemanticDiagnostics());
  });

  it("reports unknown when a call argument depends on an unsupported callee result", async () => {
    const { program } = await createProgram(`
      declare function opaque(): bigint;
      function successor(value: bigint) with { requires: value >= 0n; }: bigint {
        return value + 1n;
      }
      successor(opaque());
    `);
    const artifact = program.getVerificationArtifacts!().find(candidate => candidate.kind === "call-precondition")!;
    assert.equal(artifact.status, "unknown");
    assert.equal(artifact.outcome, "unknown");
    assert.equal(artifact.reason?.code, "unsupported");
    assert.include(artifact.message, "outside the supported verification subset");
  });

  it("uses caller path assumptions to prove requires clauses", async () => {
    const { program } = await createProgram(`
      function successor(value: bigint) with { requires: value >= 0n; }: bigint {
        return value + 1n;
      }
      function wrapper(value: bigint) with { requires: value >= 0n; }: bigint {
        return successor(value);
      }
    `);
    const artifact = program.getVerificationArtifacts!().find(candidate => candidate.kind === "call-precondition")!;
    assert.equal(artifact.status, "proved");
    assert.isEmpty(program.getSemanticDiagnostics());
  });

  it("uses branch facts to prove requires clauses", async () => {
    const { program } = await createProgram(`
      function positive(value: bigint) with { requires: value > 0n; }: bigint {
        return value;
      }
      function guarded(value: bigint): bigint {
        if (value > 0n) positive(value);
        return value;
      }
    `);
    const artifact = program.getVerificationArtifacts!().find(candidate => candidate.kind === "call-precondition")!;
    assert.equal(artifact.status, "proved");
    assert.isEmpty(program.getSemanticDiagnostics());
  });

  it("verifies every return path", async () => {
    const { program } = await createProgram(`
      function absolute(x: bigint) with { ensures: result >= 0n; }: bigint {
        if (x >= 0n) return x;
        return -x;
      }
    `);
    const artifacts = program.getVerificationArtifacts!();
    assert.lengthOf(artifacts, 2);
    assert.isTrue(artifacts.every(artifact => artifact.status === "proved"));
  });

  it("uses TypeScript control-flow narrowing for discriminated unions", async () => {
    const { program } = await createProgram(`
      type Result =
        | { _tag: "Success"; value: bigint }
        | { _tag: "Failure"; code: bigint };

      function extract(input: Result) with { ensures: result === result; }: bigint {
        if (input._tag === "Success") return input.value;
        return input.code;
      }
    `);
    const artifacts = program.getVerificationArtifacts!();
    assert.lengthOf(artifacts, 2);
    assert.isTrue(artifacts.every(artifact => artifact.status === "proved"));
    assert.isTrue(artifacts.every(artifact => artifact.solverInput.includes("declare-datatypes")));
    assert.isEmpty(program.getSemanticDiagnostics());
  });

  it("lowers TS++ data declarations through their checker union type", async () => {
    const { program } = await createProgram(
      `
      data Result = Success(value: bigint) | Failure(code: bigint);

      function extract(input: Result) with { ensures: result === result; }: bigint {
        if (input._tag === "Success") return input.value;
        return input.code;
      }
    `,
      ["dataDeclarations", "formalContracts"],
    );
    const artifacts = program.getVerificationArtifacts!();
    assert.lengthOf(artifacts, 2);
    assert.isTrue(artifacts.every(artifact => artifact.status === "proved"));
    assert.isTrue(artifacts.every(artifact => artifact.solverInput.includes("tspp.ctor")));
    assert.isEmpty(program.getSemanticDiagnostics());
  });

  it("proves contracts over non-recursive record fields", async () => {
    const { program } = await createProgram(`
      function sum(point: { x: bigint; y: bigint }) with {
        ensures: result === result;
      }: bigint {
        return point.x + point.y;
      }
    `);
    const [artifact] = program.getVerificationArtifacts!();
    assert.equal(artifact.status, "proved");
    assert.include(artifact.solverInput, "declare-datatypes");
    const diagnostics = program.getSemanticDiagnostics();
    assert.isEmpty(diagnostics, diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));
  });

  it("supports string equality without treating strings as arithmetic", async () => {
    const { program } = await createProgram(`
      function echo(value: string) with { ensures: result === value; }: string {
        return value;
      }
    `);
    const [artifact] = program.getVerificationArtifacts!();
    assert.equal(artifact.status, "proved");
    assert.include(artifact.solverInput, "String");
    assert.isEmpty(program.getSemanticDiagnostics());
  });

  it("reports unsupported optional and recursive structures as unknown", async () => {
    const optional = await createProgram(`
      type OptionalResult =
        | { _tag: "Some"; value?: bigint }
        | { _tag: "None" };
      function inspect(input: OptionalResult) with { ensures: result === result; }: bigint {
        return 0n;
      }
    `);
    const [optionalArtifact] = optional.program.getVerificationArtifacts!();
    assert.equal(optionalArtifact.status, "unknown");
    assert.include(optionalArtifact.message, "Optional property");

    const recursive = await createProgram(
      `
      data List = Nil | Cons(head: bigint, tail: List);
      function inspect(input: List) with { ensures: result === result; }: bigint {
        return 0n;
      }
    `,
      ["dataDeclarations", "formalContracts"],
    );
    const [recursiveArtifact] = recursive.program.getVerificationArtifacts!();
    assert.equal(recursiveArtifact.status, "unknown");
    assert.include(recursiveArtifact.message, "Recursive type");
  });

  it("reports unsupported expressions as unknown without invoking Z3", async () => {
    const { program } = await createProgram(`
      declare function identity(value: bigint): bigint;
      function opaque(x: bigint) with { ensures: result === x; }: bigint {
        return identity(x);
      }
    `);
    const [artifact] = program.getVerificationArtifacts!();
    assert.equal(artifact.status, "unknown");
    assert.include(artifact.message, "outside the supported verification subset");
    assert.include(artifact.replayableSmtLib, "No SMT query was executed");
    assert.include(ts.flattenDiagnosticMessageText(program.getSemanticDiagnostics()[0].messageText, "\n"), "verification unknown");
  });

  it("requires an explicit mathematical-real model for number", async () => {
    const withoutModel = await createProgram(`
      function addOne(x: number) with { ensures: result === x + 1; }: number { return x + 1; }
    `);
    assert.equal(withoutModel.program.getVerificationArtifacts!()[0].status, "unknown");
    assert.include(withoutModel.program.getVerificationArtifacts!()[0].message, "numberModel");
    assert.lengthOf(withoutModel.program.getSemanticDiagnostics().filter(diagnostic => diagnostic.code === 18090), 1);

    const withModel = await createProgram(`
      function addOne(x: number) with {
        numberModel: "mathematical-real";
        ensures: result === x + 1;
      }: number { return x + 1; }
    `);
    assert.equal(withModel.program.getVerificationArtifacts!()[0].status, "proved");
  });

  it("parses and prints refinement type aliases", () => {
    const file = ts.createSourceFile(
      "/file.tspp",
      'type Positive = number with { numberModel: "mathematical-real"; predicate: value > 0; };',
      ts.ScriptTarget.Latest,
      /*setParentNodes*/ true,
    );
    assert.isEmpty(file.parseDiagnostics);
    const declaration = file.statements[0] as ts.TypeAliasDeclaration;
    assert.equal(declaration.withClause?.properties.length, 2);
    assert.include(ts.createPrinter().printFile(file), 'with { numberModel: "mathematical-real"; predicate: value > 0; }');
  });

  it("proves refinement type introduction and erases its predicate", async () => {
    const { fs, program } = await createProgram(
      `
      type Positive = number with {
        numberModel: "mathematical-real";
        predicate: value > 0;
      };
      const age: Positive = 18;
    `,
      ["formalContracts", "refinementTypes"],
    );
    const [artifact] = program.getVerificationArtifacts!();
    assert.equal(artifact.kind, "refinement");
    assert.equal(artifact.obligation, "refinement-introduction");
    assert.equal(artifact.status, "proved");
    assert.isEmpty(program.getSemanticDiagnostics());
    const emit = program.emit();
    assert.isFalse(emit.emitSkipped);
    const js = fs.readFileSync("/file.js").toString();
    assert.include(js, "const age = 18");
    assert.notInclude(js, "predicate");
  });

  it("proves with constraints on newtype constructor calls", async () => {
    const { fs, program } = await createProgram(
      `
      newtype Port = bigint with {
        predicate: value > 0n && value <= 65535n;
      };
      const http = Port(80n);
    `,
      ["newtypeDeclarations", "formalContracts", "refinementTypes"],
    );
    const [artifact] = program.getVerificationArtifacts!();
    assert.equal(artifact.kind, "refinement");
    assert.equal(artifact.status, "proved");
    assert.isEmpty(program.getSemanticDiagnostics());
    const emit = program.emit();
    assert.isFalse(emit.emitSkipped);
    const js = fs.readFileSync("/file.js").toString();
    assert.include(js, "function Port(value)");
    assert.notInclude(js, "predicate");
  });

  it("rejects a refinement type introduction with a counterexample", async () => {
    const { program } = await createProgram(
      `
      type Positive = bigint with { predicate: value > 0n; };
      const bad: Positive = -1n;
    `,
      ["formalContracts", "refinementTypes"],
    );
    const [artifact] = program.getVerificationArtifacts!();
    assert.equal(artifact.kind, "refinement");
    assert.equal(artifact.status, "failed");
    assert.include(ts.flattenDiagnosticMessageText(program.getSemanticDiagnostics()[0].messageText, "\n"), "proof failed");
  });

  it("uses branch facts when proving refinement introduction", async () => {
    const { program } = await createProgram(
      `
      type Positive = bigint with { predicate: value > 0n; };
      function guarded(value: bigint): Positive {
        if (value > 0n) return value;
        return 1n;
      }
    `,
      ["formalContracts", "refinementTypes"],
    );
    const [artifact] = program.getVerificationArtifacts!();
    assert.equal(artifact.kind, "refinement");
    assert.equal(artifact.status, "proved");
  });

  it("propagates a stronger refinement through a function parameter", async () => {
    const { program } = await createProgram(
      `
      type Positive = bigint with { predicate: value > 0n; };
      type NonNegative = bigint with { predicate: value >= 0n; };
      function widen(value: Positive): NonNegative {
        return value;
      }
    `,
      ["formalContracts", "refinementTypes"],
    );
    const [artifact] = program.getVerificationArtifacts!();
    assert.equal(artifact.kind, "refinement");
    assert.equal(artifact.status, "proved");
  });

  it("does not silently accept contracts through the synchronous API", () => {
    const fileName = "/sync.tspp";
    const content = "function same(x: bigint) with { ensures: result === x; }: bigint { return x; }";
    const options: ts.CompilerOptions = { noLib: true, tsppFeatures: ["formalContracts"] };
    const fs = vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument(fileName, content)], cwd: "/" },
    );
    const host = new fakes.CompilerHost(fs, options);
    const program = ts.createProgram({ host, rootNames: [fileName], options });
    const [artifact] = program.getVerificationArtifacts!();
    assert.equal(artifact.status, "unknown");
    assert.include(artifact.message, "createProgramAsync");
    assert.include(ts.flattenDiagnosticMessageText(program.getSemanticDiagnostics()[0].messageText, "\n"), "verification unknown");
  });

  it("does not silently accept refinement construction through the synchronous API", () => {
    const fileName = "/sync-refinement.tspp";
    const content = `
      type Positive = bigint with { predicate: value > 0n; };
      const value: Positive = 1n;
    `;
    const options: ts.CompilerOptions = {
      noLib: true,
      target: ts.ScriptTarget.ES2022,
      tsppFeatures: ["formalContracts", "refinementTypes"],
    };
    const fs = vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument(fileName, content)], cwd: "/" },
    );
    const host = new fakes.CompilerHost(fs, options);
    const program = ts.createProgram({ host, rootNames: [fileName], options });
    const [artifact] = program.getVerificationArtifacts!();
    assert.equal(artifact.kind, "refinement");
    assert.equal(artifact.status, "unknown");
    assert.include(artifact.message, "createProgramAsync");
    assert.include(ts.flattenDiagnosticMessageText(program.getSemanticDiagnostics()[0].messageText, "\n"), "verification unknown");
  });

  it("does not silently accept call preconditions through the synchronous API", () => {
    const fileName = "/sync-call.tspp";
    const content = `
      function successor(value: bigint) with { requires: value >= 0n; }: bigint { return value + 1n; }
      successor(-5n);
    `;
    const options: ts.CompilerOptions = { noLib: true, target: ts.ScriptTarget.ES2022, tsppFeatures: ["formalContracts"] };
    const fs = vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument(fileName, content)], cwd: "/" },
    );
    const host = new fakes.CompilerHost(fs, options);
    const program = ts.createProgram({ host, rootNames: [fileName], options });
    const artifact = program.getVerificationArtifacts!().find(candidate => candidate.kind === "call-precondition")!;
    assert.equal(artifact.status, "unknown");
    assert.include(artifact.message, "createProgramAsync");
  });

  it("completes formal verification in the background for synchronous language-service programs", async () => {
    const fileName = "/language-service.tspp";
    const content = "function same(x: bigint) with { ensures: result === x; }: bigint { return x; }";
    const options: ts.CompilerOptions = { noLib: true, target: ts.ScriptTarget.ES2022, tsppFeatures: ["formalContracts"] };
    const fs = vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument(fileName, content)], cwd: "/" },
    );
    const host = new fakes.CompilerHost(fs, options);
    const formalHost = host as ts.CompilerHost;
    let cached: ts.AsyncFormalVerification | undefined;
    let completion: Promise<void> | undefined;
    formalHost.getResolvedAsyncFormalVerification = () => cached;
    formalHost.isAsyncFormalVerificationPending = () => completion !== undefined && cached === undefined;
    formalHost.scheduleAsyncFormalVerification = (_key, evaluation) => {
      completion = evaluation.then(artifacts => void (cached = artifacts));
    };

    const pendingProgram = ts.createProgram({ host: formalHost, rootNames: [fileName], options });
    assert.include(pendingProgram.getVerificationArtifacts!()[0].message, "running asynchronously");
    assert.isEmpty(pendingProgram.getSemanticDiagnostics().filter(diagnostic => diagnostic.code === 18090));

    await completion;
    const verifiedProgram = ts.createProgram({ host: formalHost, rootNames: [fileName], options });
    assert.equal(verifiedProgram.getVerificationArtifacts!()[0].status, "proved");
    assert.isEmpty(verifiedProgram.getSemanticDiagnostics());
  });

  it("refreshes a language-service program after background verification", async () => {
    const fileName = "/language-service-refresh.tspp";
    const content = "function bad(x: bigint) with { ensures: result > x; }: bigint { return x; }";
    const options: ts.CompilerOptions = { noLib: true, target: ts.ScriptTarget.ES2022, tsppFeatures: ["formalContracts"] };
    let notifyVerificationComplete!: () => void;
    const verificationComplete = new Promise<void>(resolve => notifyVerificationComplete = resolve);
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => options,
      getScriptFileNames: () => [fileName],
      getScriptVersion: () => "1",
      getScriptSnapshot: name => name === fileName ? ts.ScriptSnapshot.fromString(content) : undefined,
      getCurrentDirectory: () => "/",
      getDefaultLibFileName: () => "/lib.d.ts",
      fileExists: name => name === fileName,
      readFile: name => name === fileName ? content : undefined,
      readDirectory: () => [],
      onAsyncMacroExpansionComplete: notifyVerificationComplete,
    };
    const service = ts.createLanguageService(host);
    const pendingProgram = service.getProgram()!;

    await verificationComplete;
    assert.strictEqual(service.getCurrentProgram(), pendingProgram);
    const diagnostics = service.getSemanticDiagnostics(fileName);
    assert.notStrictEqual(service.getCurrentProgram(), pendingProgram);
    assert.include(ts.flattenDiagnosticMessageText(diagnostics.find(diagnostic => diagnostic.code === 18090)!.messageText, "\n"), "proof failed");
  });
});

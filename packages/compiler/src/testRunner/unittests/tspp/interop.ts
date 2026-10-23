import * as documents from "../../_namespaces/documents.js";
import * as fakes from "../../_namespaces/fakes.js";
import * as Harness from "../../_namespaces/Harness.js";
import * as ts from "../../_namespaces/ts.js";
import * as vfs from "../../_namespaces/vfs.js";

describe("unittests:: tspp:: TypeScript interoperability", () => {
  const tsppFeatures = ["higherKindedTypes", "newtypeDeclarations", "dataDeclarations", "typeComputation", "macros"];

  function createProgram(files: Record<string, string>, rootNames: string[], options: ts.CompilerOptions = {}) {
    const fs = vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: Object.entries(files).map(([fileName, content]) => new documents.TextDocument(fileName, content)), cwd: "/" },
    );
    const compilerOptions: ts.CompilerOptions = {
      noLib: true,
      strict: true,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      tsppFeatures,
      ...options,
    };
    const host = new fakes.CompilerHost(fs, compilerOptions);
    return { fs, host, program: ts.createProgram({ host, rootNames, options: compilerOptions }) };
  }

  function messages(program: ts.Program) {
    return program.getSemanticDiagnostics().map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  }

  it("allows TS++ source to import TypeScript source", () => {
    const { fs, program } = createProgram(
      {
        "/plain.ts": `export const answer: number = 42;`,
        "/consumer.tspp": `
          import { answer } from "./plain";
          newtype UserId = number;
          export const checked: number = answer;
          export const asserted = answer as UserId;
        `,
      },
      ["/consumer.tspp"],
      { declaration: true, emitDeclarationOnly: true },
    );
    assert.deepEqual(messages(program), []);
    assert.isFalse(program.emit().emitSkipped);
    assert.isTrue(fs.existsSync("/plain.d.ts"));
    assert.isFalse(fs.existsSync("/plain.d.tspp"));
    assert.isTrue(fs.existsSync("/consumer.d.ts"));
    assert.isTrue(fs.existsSync("/consumer.d.tspp"));
  });

  it("does not allow TypeScript source to import TS++ source", () => {
    const { program } = createProgram(
      {
        "/advanced.tspp": `export const answer: number = 42;`,
        "/consumer.ts": `import { answer } from "./advanced"; export const checked: number = answer;`,
      },
      ["/consumer.ts", "/advanced.tspp"],
    );
    assert.match(messages(program).join("\n"), /Cannot find module '.\/advanced'/);
  });

  it("selects tsppTypes for TS++ sources and types for TypeScript sources", () => {
    const files = {
      "/node_modules/dual-package/package.json": JSON.stringify({
        name: "dual-package",
        version: "1.0.0",
        main: "index.js",
        types: "index.d.ts",
        tsppTypes: "index.d.tspp",
      }),
      "/node_modules/dual-package/index.js": `exports.flavor = "runtime";`,
      "/node_modules/dual-package/index.d.ts": `export declare const flavor: "ts";`,
      "/node_modules/dual-package/index.d.tspp": `export declare const flavor: "tspp";`,
      "/plain.ts": `import { flavor } from "dual-package"; export const checked: "ts" = flavor;`,
      "/advanced.tspp": `import { flavor } from "dual-package"; export const checked: "tspp" = flavor;`,
    };
    const { program } = createProgram(files, ["/plain.ts", "/advanced.tspp"]);
    assert.deepEqual(messages(program), []);
  });

  it("supports the tspp-types package exports condition", () => {
    const files = {
      "/node_modules/exports-package/package.json": JSON.stringify({
        name: "exports-package",
        version: "1.0.0",
        exports: {
          ".": {
            "tspp-types": "./index.d.tspp",
            "types": "./index.d.ts",
            "default": "./index.js",
          },
        },
      }),
      "/node_modules/exports-package/index.js": `exports.flavor = "runtime";`,
      "/node_modules/exports-package/index.d.ts": `export declare const flavor: "ts";`,
      "/node_modules/exports-package/index.d.tspp": `export declare const flavor: "tspp";`,
      "/plain.ts": `import { flavor } from "exports-package"; export const checked: "ts" = flavor;`,
      "/advanced.tspp": `import { flavor } from "exports-package"; export const checked: "tspp" = flavor;`,
    };
    const { program } = createProgram(files, ["/plain.ts", "/advanced.tspp"], {
      module: ts.ModuleKind.Node16,
      moduleResolution: ts.ModuleResolutionKind.Node16,
    });
    assert.deepEqual(messages(program), []);
  });

  it("emits a full .d.tspp and a TypeScript-compatible .d.ts", () => {
    const { fs, program } = createProgram(
      {
        "/dependency.tspp": `export interface External { value: number }`,
        "/library.tspp": `
          export type { External } from "./dependency.tspp";
          newtype UserId = number;
          data Option<T> = None | Some(value: T);
          type Apply<F: Type => Type, A> = F<A>;
          type Classify<T> = match T { string: "text", _: "other" };
          export macro function inspect() {}
          export { UserId, None, Some };
          export type { Option, Apply, Classify };
        `,
      },
      ["/library.tspp", "/dependency.tspp"],
      { declaration: true, emitDeclarationOnly: true, allowImportingTsExtensions: true },
    );

    const result = program.emit();
    assert.isFalse(result.emitSkipped, result.diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"));

    const full = fs.readFileSync("/library.d.tspp").toString();
    const compatibility = fs.readFileSync("/library.d.ts").toString();
    assert.include(full, "newtype UserId = number;");
    assert.include(full, "data Option<T> = None | Some(value: T);");
    assert.include(full, "match T");
    assert.include(full, "export declare macro function inspect()");
    assert.include(compatibility, "type UserId = number;");
    assert.include(compatibility, "declare function UserId(value: number): UserId;");
    assert.include(compatibility, `readonly _tag: "Some"`);
    assert.include(compatibility, "type Apply<F, A> = unknown;");
    assert.include(compatibility, "type Classify<T> = unknown;");
    assert.notInclude(compatibility, "inspect");
    assert.include(compatibility, `from "./dependency.js"`);
    assert.notInclude(compatibility, ".tspp");

    const compatibilityProgram = createProgram(
      {
        "/library.d.ts": compatibility,
        "/dependency.d.ts": fs.readFileSync("/dependency.d.ts").toString(),
      },
      ["/library.d.ts"],
      { tsppFeatures: [] },
    ).program;
    assert.deepEqual(messages(compatibilityProgram), []);
  });
});

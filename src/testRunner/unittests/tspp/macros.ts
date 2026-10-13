import * as documents from "../../_namespaces/documents.js";
import * as fakes from "../../_namespaces/fakes.js";
import * as Harness from "../../_namespaces/Harness.js";
import * as ts from "../../_namespaces/ts.js";
import * as vfs from "../../_namespaces/vfs.js";

describe("unittests:: tspp:: macros", () => {
  function createProgram(content: string, options: ts.CompilerOptions = {}) {
    const fileName = "/file.tspp";
    const compilerOptions: ts.CompilerOptions = {
      noLib: true,
      noImplicitAny: false,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      tsppFeatures: ["macros"],
      ...options,
    };
    const fs = vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      { documents: [new documents.TextDocument(fileName, content)], cwd: "/" },
    );
    const host = new fakes.CompilerHost(fs, compilerOptions);
    return { fs, program: ts.createProgram({ host, rootNames: [fileName], options: compilerOptions }) };
  }

  const expandingSource = `
    macro function exposeTypeName(targets, context) {
      const target = targets[0];
      const literal = context.factory.createStringLiteral(target.name);
      const declaration = context.factory.createVariableDeclaration(
        target.name + "TypeName",
        undefined,
        context.factory.createLiteralTypeNode(literal),
        literal,
      );
      return context.factory.createVariableStatement(
        undefined,
        context.factory.createVariableDeclarationList([declaration]),
      );
    }

    interface User { id: number }
    macro exposeTypeName(User);
    const checked: "User" = UserTypeName;
  `;

  it("rebuilds the final program from returned statements", () => {
    const { program } = createProgram(expandingSource);
    const diagnostics = program.getSemanticDiagnostics();
    assert.isEmpty(diagnostics, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));

    const file = program.getSourceFile("/file.tspp")!;
    assert.include(file.text, "macro exposeTypeName(User)");
    assert.isTrue(file.statements.some(ts.isMacroInvocationStatement));
    assert.isTrue(file.statements.some(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === "UserTypeName")));

    const [expansion] = program.getMacroExpansions!("/file.tspp");
    assert.equal(expansion.macroName, "exposeTypeName");
    assert.equal(expandingSource.slice(expansion.start, expansion.start + expansion.length), "macro exposeTypeName(User);");
    assert.include(expansion.text, 'var UserTypeName: "User" = "User";');
  });

  it("keeps macro functions in JS, erases calls, and preserves the declaration marker", () => {
    const { fs, program } = createProgram(expandingSource, { declaration: true });
    const result = program.emit();
    assert.isFalse(result.emitSkipped);
    const js = fs.readFileSync("/file.js").toString();
    const dts = fs.readFileSync("/file.d.tspp").toString();

    assert.include(js, "function exposeTypeName");
    assert.notInclude(js, "macro exposeTypeName");
    assert.include(js, 'var UserTypeName = "User";');
    assert.include(dts, "declare macro function exposeTypeName");
    assert.include(dts, 'declare var UserTypeName: "User";');
  });

  it("loads source macros and targets through imports", () => {
    const compilerOptions: ts.CompilerOptions = {
      noLib: true,
      noImplicitAny: false,
      noUnusedLocals: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      target: ts.ScriptTarget.ES2022,
      tsppFeatures: ["macros"],
    };
    const fs = vfs.createFromFileSystem(
      Harness.IO,
      /*ignoreCase*/ true,
      {
        documents: [
          new documents.TextDocument(
            "/macros.tspp",
            `
            export macro function expose([target], context) {
              return context.factory.createVariableStatement(
                undefined,
                context.factory.createVariableDeclarationList([
                  context.factory.createVariableDeclaration(
                    target.name + "TypeName",
                    undefined,
                    context.factory.createLiteralTypeNode(
                      context.factory.createStringLiteral(target.name),
                    ),
                    context.factory.createStringLiteral(target.name),
                  ),
                ]),
              );
            }
          `,
          ),
          new documents.TextDocument("/models.tspp", "export interface User { id: number }"),
          new documents.TextDocument(
            "/index.tspp",
            `
            import { expose } from "./macros";
            import { User } from "./models";
            macro expose(User);
            export const checked: "User" = UserTypeName;
          `,
          ),
        ],
        cwd: "/",
      },
    );
    const host = new fakes.CompilerHost(fs, compilerOptions);
    const program = ts.createProgram({ host, rootNames: ["/index.tspp"], options: compilerOptions });
    const diagnostics = program.getSemanticDiagnostics();
    assert.isEmpty(diagnostics, diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));
    const file = program.getSourceFile("/index.tspp")!;
    assert.include(file.text, "macro expose(User)");
    assert.isTrue(file.statements.some(statement => ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === "UserTypeName")));
  });

  it("turns validation failures into diagnostics", () => {
    const { program } = createProgram(`
      macro function reject(_targets, context) {
        return context.fail("User must have an id");
      }
      interface User {}
      macro reject(User);
    `);
    const messages = program.getSemanticDiagnostics().map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    assert.include(messages.join("\n"), "User must have an id");
    assert.equal(program.getMacroExpansions!("/file.tspp")[0].text, "");
  });

  it("requires the macros feature flag", () => {
    const { program } = createProgram(
      `
      macro function validate() {}
      macro validate();
    `,
      { tsppFeatures: [] },
    );
    const messages = program.getSemanticDiagnostics().map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    assert.match(messages.join("\n"), /feature 'macros' is not enabled/);
  });

  it("keeps editor positions and quick info aligned with the original source", () => {
    const content = `
      /** Checks the selected declarations. */
      macro function validate() {}
      interface User { id: number }
      macro validate(User);
      const user: User = { id: 1 };
    `;
    const adapter = new Harness.LanguageService.NativeLanguageServiceAdapter(
      /*cancellationToken*/ undefined,
      {
        noLib: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        tsppFeatures: ["macros"],
      },
    );
    const host = adapter.getHost();
    host.addScript("file.tspp", content, /*isRootFile*/ true);
    const service = adapter.getLanguageService();
    const macroPosition = content.indexOf("validate(User)");
    const macroInfo = service.getQuickInfoAtPosition("file.tspp", macroPosition + 1)!;
    assert.include(ts.displayPartsToString(macroInfo.displayParts), "validate");
    assert.equal(ts.displayPartsToString(macroInfo.documentation), "Checks the selected declarations.");

    const targetPosition = content.indexOf("User);", macroPosition);
    const targetInfo = service.getQuickInfoAtPosition("file.tspp", targetPosition + 1)!;
    assert.include(ts.displayPartsToString(targetInfo.displayParts), "interface User");

    const diagnostics = service.getSemanticDiagnostics("file.tspp");
    assert.notInclude(diagnostics.map(diagnostic => diagnostic.code), 6133);
  });
});

const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

function activate(context) {
  const repositoryRoot = path.resolve(context.extensionPath, "..");
  const compilerPath = path.join(repositoryRoot, "built", "local", "tsserver.js");
  const typescriptPath = path.join(repositoryRoot, "built", "local", "typescript.js");
  const examplesRoot = path.join(repositoryRoot, "example");
  const examples = [
    {
      label: "01 — Higher-Kinded Types",
      description: "Kinds, type constructors, and universes",
      command: "tspp.openHigherKindedTypesExample",
      directory: path.join(examplesRoot, "01-higher-kinded-types"),
      entry: "index.tspp",
    },
    {
      label: "02 — Dependent Types",
      description: "A beginner-friendly introduction to native MLTT types",
      command: "tspp.openDependentTypesExample",
      directory: path.join(examplesRoot, "02-dependent-types"),
      entry: path.join("src", "01-basics.tspp"),
    },
    {
      label: "03 — Newtype and Data",
      description: "Nominal types, discriminated unions, and variant constructors",
      command: "tspp.openNewtypeAndDataExample",
      directory: path.join(examplesRoot, "03-newtype-and-data"),
      entry: "index.tspp",
    },
  ];

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "tspp.pickExample";
  context.subscriptions.push(status);

  if (!fs.existsSync(compilerPath)) {
    status.text = "$(error) TS++ compiler not built";
    status.tooltip = "Run npm run build:compiler in the repository, then restart this development host.";
    status.show();
    return;
  }

  status.text = "$(beaker) TS++ Examples";
  status.tooltip = `Using ${compilerPath}. Click to choose an example.`;
  status.show();

  const macroDiagnostics = vscode.languages.createDiagnosticCollection("tspp-macros");
  context.subscriptions.push(macroDiagnostics);

  const macroExpansionCache = new Map();
  let macroExpansionQueue = Promise.resolve();

  function getMacroExpansions(document) {
    if (document.uri.scheme !== "file" || path.extname(document.fileName).toLowerCase() !== ".tspp") return Promise.resolve([]);
    const cacheKey = `${document.uri.toString()}:${document.version}`;
    const cached = macroExpansionCache.get(cacheKey);
    if (cached) return cached;

    const pending = macroExpansionQueue.then(() => computeMacroExpansions(document));
    macroExpansionQueue = pending.then(() => undefined, () => undefined);
    macroExpansionCache.set(cacheKey, pending);
    return pending;
  }

  async function computeMacroExpansions(document) {
    let expansions = [];
    const documentVersion = document.version;
    try {
      const ts = require(typescriptPath);
      const configPath = ts.findConfigFile(path.dirname(document.fileName), ts.sys.fileExists, "tsppconfig.json");
      if (!configPath) return [];
      const config = ts.readConfigFile(configPath, ts.sys.readFile);
      if (config.error) return [];
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath), /*existingOptions*/ undefined, configPath);
      const host = ts.createCompilerHost(parsed.options);
      const originalGetSourceFile = host.getSourceFile.bind(host);
      host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
        const openDocument = vscode.workspace.textDocuments.find(candidate => candidate.uri.scheme === "file" && samePath(fileName, candidate.fileName));
        if (openDocument) {
          return ts.createSourceFile(fileName, openDocument.getText(), languageVersionOrOptions, /*setParentNodes*/ true, ts.ScriptKind.TS);
        }
        return originalGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
      };
      const rootNames = parsed.fileNames.some(fileName => samePath(fileName, document.fileName))
        ? parsed.fileNames
        : [...parsed.fileNames, document.fileName];
      const program = await ts.createProgramAsync({ rootNames, options: parsed.options, host });
      expansions = program.getMacroExpansions?.(document.fileName) || [];
      const sourceFile = program.getSourceFile(document.fileName);
      const diagnostics = sourceFile
        ? program.getSemanticDiagnostics(sourceFile).filter(diagnostic => diagnostic.code >= 18080 && diagnostic.code <= 18082)
        : [];
      if (!document.isClosed && document.version === documentVersion) {
        macroDiagnostics.set(document.uri, diagnostics.map(diagnostic => toVscodeDiagnostic(ts, document, diagnostic)));
      }
    }
    catch {
      // Keep previews and fallback diagnostics unavailable while the source is incomplete.
      if (!document.isClosed && document.version === documentVersion) macroDiagnostics.delete(document.uri);
    }
    return expansions;
  }

  function toVscodeDiagnostic(ts, document, diagnostic) {
    const start = Math.max(0, Math.min(document.getText().length, diagnostic.start || 0));
    const end = Math.max(start, Math.min(document.getText().length, start + (diagnostic.length || 0)));
    const result = new vscode.Diagnostic(
      new vscode.Range(document.positionAt(start), document.positionAt(end)),
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      vscode.DiagnosticSeverity.Error,
    );
    result.code = diagnostic.code;
    result.source = "TS++ macro";
    return result;
  }

  async function expansionAt(document, position) {
    const offset = document.offsetAt(position);
    return (await getMacroExpansions(document)).find(expansion => expansion.start <= offset && offset <= expansion.start + expansion.length);
  }

  const macroSelector = { language: "typescript", scheme: "file", pattern: "**/*.tspp" };
  const expandedDocuments = new Map();
  const expandedDocumentChanges = new vscode.EventEmitter();
  const expandedDocumentProvider = {
    onDidChange: expandedDocumentChanges.event,
    provideTextDocumentContent(uri) {
      return expandedDocuments.get(uri.toString()) || "";
    },
  };

  async function createExpandedSource(document) {
    let text = document.getText();
    const expansions = [...await getMacroExpansions(document)].sort((left, right) => right.start - left.start);
    for (const expansion of expansions) {
      text = text.slice(0, expansion.start) + expansion.text + text.slice(expansion.start + expansion.length);
    }
    return { expansions, text };
  }

  context.subscriptions.push(
    expandedDocumentChanges,
    vscode.workspace.registerTextDocumentContentProvider("tspp-expanded", expandedDocumentProvider),
    vscode.languages.registerHoverProvider(macroSelector, {
      async provideHover(document, position) {
        const expansion = await expansionAt(document, position);
        if (!expansion) return undefined;
        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`**TS++ macro expansion: \`${expansion.macroName}\`**\n\n`);
        if (expansion.text.trim()) {
          markdown.appendCodeblock(expansion.text, "typescript");
        }
        else {
          markdown.appendMarkdown("This is a validation-only macro; it emits no statements.");
        }
        return new vscode.Hover(
          markdown,
          new vscode.Range(
            document.positionAt(expansion.start),
            document.positionAt(expansion.start + expansion.length),
          ),
        );
      },
    }),
    vscode.commands.registerCommand("tspp.showExpandedSource", async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document || document.uri.scheme !== "file" || path.extname(document.fileName).toLowerCase() !== ".tspp") return;
      const result = await createExpandedSource(document);
      if (!result.expansions.length) {
        await vscode.window.showInformationMessage("This file contains no compile-time macro invocations.");
        return;
      }
      const expandedPath = document.uri.path.replace(/\.tspp$/i, ".expanded.tspp");
      const expandedUri = vscode.Uri.from({
        scheme: "tspp-expanded",
        path: expandedPath,
        query: `source=${encodeURIComponent(document.uri.toString())}`,
      });
      expandedDocuments.set(expandedUri.toString(), result.text);
      expandedDocumentChanges.fire(expandedUri);
      let expandedDocument = await vscode.workspace.openTextDocument(expandedUri);
      if (expandedDocument.languageId !== "typescript") {
        expandedDocument = await vscode.languages.setTextDocumentLanguage(expandedDocument, "typescript");
      }
      await vscode.window.showTextDocument(expandedDocument, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
      });
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      macroExpansionCache.clear();
      scheduleMacroDiagnostics(event.document);
    }),
    vscode.workspace.onDidSaveTextDocument(document => {
      macroExpansionCache.clear();
      scheduleMacroDiagnostics(document, /*delay*/ 0);
    }),
    vscode.workspace.onDidOpenTextDocument(document => scheduleMacroDiagnostics(document, /*delay*/ 0)),
    vscode.workspace.onDidCloseTextDocument(document => macroDiagnostics.delete(document.uri)),
  );

  const macroDiagnosticTimers = new Map();
  context.subscriptions.push({
    dispose() {
      for (const timer of macroDiagnosticTimers.values()) clearTimeout(timer);
      macroDiagnosticTimers.clear();
    },
  });

  function scheduleMacroDiagnostics(document, delay = 250) {
    if (document.uri.scheme !== "file" || path.extname(document.fileName).toLowerCase() !== ".tspp") return;
    const key = document.uri.toString();
    const previous = macroDiagnosticTimers.get(key);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      macroDiagnosticTimers.delete(key);
      void getMacroExpansions(document);
    }, delay);
    macroDiagnosticTimers.set(key, timer);
  }

  for (const document of vscode.workspace.textDocuments) scheduleMacroDiagnostics(document, /*delay*/ 0);

  async function openExample(example, viewColumn = vscode.ViewColumn.Active) {
    const document = await vscode.workspace.openTextDocument(path.join(example.directory, example.entry));
    await vscode.window.showTextDocument(document, { viewColumn, preview: false });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("tspp.openHigherKindedTypesExample", () => openExample(examples[0])),
    vscode.commands.registerCommand("tspp.openDependentTypesExample", () => openExample(examples[1])),
    vscode.commands.registerCommand("tspp.openNewtypeAndDataExample", () => openExample(examples[2])),
    vscode.commands.registerCommand("tspp.openAllExamples", async () => {
      await openExample(examples[0], vscode.ViewColumn.One);
      await openExample(examples[1], vscode.ViewColumn.Two);
      await openExample(examples[2], vscode.ViewColumn.Three);
    }),
    vscode.commands.registerCommand("tspp.pickExample", async () => {
      const selection = await vscode.window.showQuickPick(
        [
          { label: "All examples", description: "Open examples 01, 02 and 03 side by side", command: "tspp.openAllExamples" },
          ...examples,
        ],
        { placeHolder: "Choose a TS++ example to open" },
      );
      if (selection) await vscode.commands.executeCommand(selection.command);
    }),
  );

  if (!vscode.window.activeTextEditor) {
    const workspacePaths = (vscode.workspace.workspaceFolders || []).map(folder => path.resolve(folder.uri.fsPath));
    if (workspacePaths.some(workspacePath => samePath(workspacePath, examplesRoot))) {
      void vscode.commands.executeCommand("tspp.openAllExamples");
    }
    else {
      const activeExample = examples.find(example => workspacePaths.some(workspacePath => samePath(workspacePath, example.directory)));
      if (activeExample) void vscode.commands.executeCommand(activeExample.command);
    }
  }
}

function samePath(left, right) {
  const normalize = value => path.resolve(value).replaceAll("\\", "/").toLowerCase();
  return normalize(left) === normalize(right);
}

function deactivate() {}

module.exports = { activate, deactivate };

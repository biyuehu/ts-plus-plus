const fs = require("fs");
const path = require("path");
const vscode = require("vscode");
const { LanguageClient, TransportKind } = require("vscode-languageclient/node");

let languageClient;

async function activate(context) {
  const compilerPath = require.resolve("ts-plus-plus/tsserver");
  const typescriptPath = require.resolve("ts-plus-plus");
  const defaultSdkPath = path.dirname(require.resolve("ts-plus-plus/sdk"));
  const languageServerModule = require.resolve("tspp-language-server");
  const examplesRoot = path.dirname(require.resolve("@tspp/examples/package.json"));
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
    {
      label: "04 — Compile-Time Macros",
      description: "Compile-time AST validation and transformation",
      command: "tspp.openMacrosExample",
      directory: path.join(examplesRoot, "04-macros"),
      entry: path.join("src", "01-check.tspp"),
    },
    {
      label: "05 — Formal Contracts",
      description: "Z3-backed preconditions, postconditions, and loop invariants",
      command: "tspp.openFormalContractsExample",
      directory: path.join(examplesRoot, "05-formal-contracts"),
      entry: path.join("src", "01-function-contracts.tspp"),
    },
    {
      label: "06 — Type Computation",
      description: "Type-level let bindings, matching, and lambdas",
      command: "tspp.openTypeComputationExample",
      directory: path.join(examplesRoot, "06-type-computation"),
      entry: path.join("src", "01-let-bindings.tspp"),
    },
    {
      label: "07 — TypeScript Interop",
      description: "Mixed TS++ and TypeScript package boundaries",
      command: "tspp.openTypescriptInteropExample",
      directory: path.join(examplesRoot, "07-typescript-interop"),
      entry: path.join("src", "index.tspp"),
    },
  ];

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "tspp.pickExample";
  context.subscriptions.push(status);

  if (!fs.existsSync(compilerPath)) {
    status.text = "$(error) TS++ compiler not built";
    status.tooltip = "Run pnpm build:compiler in the repository, then restart this development host.";
    status.show();
    return;
  }

  if (!fs.existsSync(languageServerModule)) {
    status.text = "$(error) TS++ language server not built";
    status.tooltip = "Run pnpm build:language-server in the repository, then restart this development host.";
    status.show();
    return;
  }

  const configuredSdkPath = vscode.workspace.getConfiguration("tspp").get("tsdk", "").trim();
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const sdkPath = configuredSdkPath
    ? path.resolve(workspaceRoot || context.extensionPath, configuredSdkPath)
    : defaultSdkPath;
  const serverOptions = {
    run: { module: languageServerModule, transport: TransportKind.stdio },
    debug: { module: languageServerModule, transport: TransportKind.stdio },
  };
  const clientOptions = {
    documentSelector: [
      { scheme: "file", language: "tspp" },
      { scheme: "untitled", language: "tspp" },
    ],
    initializationOptions: {
      disableAutomaticTypingAcquisition: true,
      hostInfo: "vscode-tspp",
      tsserver: {
        path: sdkPath,
        useSyntaxServer: "never",
      },
    },
    errorHandler: {
      error: (_error, _message, _count) => {
        return { action: 1 /* Close */ }; // Don't show toast popups for transient errors
      },
      closed: () => {
        return { action: 1 /* DoNotRestart */ };
      },
    },
  };
  languageClient = new LanguageClient("tspp", "TS++ Language Server", serverOptions, clientOptions);
  context.subscriptions.push(
    languageClient,
    vscode.commands.registerCommand("tspp.restartLanguageServer", async () => {
      await languageClient?.restart();
    }),
    vscode.commands.registerCommand("tspp.openLanguageServerLog", () => {
      languageClient?.outputChannel.show();
    }),
  );
  status.text = "$(beaker) TS++ Examples";
  status.tooltip = `Using ${compilerPath}. Click to choose an example.`;
  status.show();

  try {
    await languageClient.start();
  }
  catch (error) {
    status.text = "$(error) TS++ language server failed";
    status.tooltip = error instanceof Error ? error.message : String(error);
    status.show();
  }

  const macroExpansionCache = new Map();
  let macroExpansionQueue = Promise.resolve();

  function getDocumentAnalysis(document) {
    if (document.uri.scheme !== "file" || path.extname(document.fileName).toLowerCase() !== ".tspp") return Promise.resolve({ expansions: [], artifacts: [] });
    const cacheKey = `${document.uri.toString()}:${document.version}`;
    const cached = macroExpansionCache.get(cacheKey);
    if (cached) return cached;

    const pending = macroExpansionQueue.then(() => computeDocumentAnalysis(document));
    macroExpansionQueue = pending.then(() => undefined, () => undefined);
    macroExpansionCache.set(cacheKey, pending);
    return pending;
  }

  async function getMacroExpansions(document) {
    return (await getDocumentAnalysis(document)).expansions;
  }

  async function getVerificationArtifacts(document) {
    return (await getDocumentAnalysis(document)).artifacts;
  }

  async function computeDocumentAnalysis(document) {
    let expansions = [];
    let artifacts = [];
    try {
      const loaded = await createOpenDocumentProgram(document);
      if (!loaded) return { expansions, artifacts };
      const { ts, program } = loaded;
      expansions = program.getMacroExpansions?.(document.fileName) || [];
      artifacts = program.getVerificationArtifacts?.(document.fileName) || [];
      return { expansions, artifacts, ts, program };
    }
    catch {
      // Keep previews unavailable while the source is incomplete.
    }
    return { expansions, artifacts };
  }

  function normalizedTypeAt(document, position, analysis) {
    const { ts, program } = analysis;
    if (!ts || !program) return undefined;
    const sourceFile = program.getSourceFile(document.fileName);
    if (!sourceFile) return undefined;
    const offset = document.offsetAt(position);
    const token = ts.getTokenAtPosition(sourceFile, offset);
    const checker = program.getTypeChecker();
    let typeNode;

    if (ts.isIdentifier(token)) {
      const declaration = ts.isTypeAliasDeclaration(token.parent) && token.parent.name === token
        ? token.parent
        : checker.getSymbolAtLocation(token)?.declarations?.find(ts.isTypeAliasDeclaration);
      if (declaration) {
        typeNode = declaration.type;
      }
    }
    if (!typeNode) {
      let candidate = token;
      while (candidate.parent && !ts.isTypeNode(candidate)) candidate = candidate.parent;
      if (ts.isTypeNode(candidate)) typeNode = candidate;
    }
    if (!typeNode) return undefined;

    const type = checker.getTypeAtLocation(typeNode);
    const isNominal = !!type.aliasSymbol?.declarations?.some(d => ts.isDataDeclaration(d) || ts.isNewtypeDeclaration(d));
    if (isNominal) return undefined;
    const normalized = checker.getNormalizedTypeAtLocation?.(typeNode)
      ?? checker.typeToString(type, typeNode, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias);
    const source = typeNode.getText(sourceFile);
    if (source.replace(/\s+/g, " ").trim() === normalized.replace(/\s+/g, " ").trim()) return undefined;
    const classification = checker.getTypeClassificationAtLocation?.(typeNode)
      ?? { label: "Kind", text: checker.getKindAtLocation?.(typeNode) || "Type0" };
    return {
      classification,
      normalized,
      range: new vscode.Range(document.positionAt(token.getStart(sourceFile)), document.positionAt(token.end)),
    };
  }

  async function createOpenDocumentProgram(document) {
    const ts = require(typescriptPath);
    const configPath = ts.findConfigFile(path.dirname(document.fileName), ts.sys.fileExists, "tsppconfig.json");
    if (!configPath) return undefined;
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    if (config.error) return undefined;
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath), /*existingOptions*/ undefined, configPath);
    const host = ts.createCompilerHost(parsed.options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
      const openDocument = vscode.workspace.textDocuments.find(candidate => candidate.uri.scheme === "file" && samePath(fileName, candidate.fileName));
      if (openDocument) return ts.createSourceFile(fileName, openDocument.getText(), languageVersionOrOptions, /*setParentNodes*/ true, ts.ScriptKind.TS);
      return originalGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
    };
    const rootNames = parsed.fileNames.some(fileName => samePath(fileName, document.fileName)) ? parsed.fileNames : [...parsed.fileNames, document.fileName];
    const program = await ts.createProgramAsync({ rootNames, options: parsed.options, host });
    return { ts, program };
  }

  const macroSelector = { language: "tspp", scheme: "file", pattern: "**/*.tspp" };
  const expandedDocuments = new Map();
  const expandedDocumentChanges = new vscode.EventEmitter();
  const expandedDocumentProvider = {
    onDidChange: expandedDocumentChanges.event,
    provideTextDocumentContent(uri) {
      return expandedDocuments.get(uri.toString()) || "";
    },
  };
  const smtDocuments = new Map();
  const smtDocumentChanges = new vscode.EventEmitter();
  const smtDocumentProvider = {
    onDidChange: smtDocumentChanges.event,
    provideTextDocumentContent(uri) {
      return smtDocuments.get(uri.toString()) || "";
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
    smtDocumentChanges,
    vscode.workspace.registerTextDocumentContentProvider("tspp-expanded", expandedDocumentProvider),
    vscode.workspace.registerTextDocumentContentProvider("tspp-smt", smtDocumentProvider),
    vscode.languages.registerHoverProvider(macroSelector, {
      async provideHover(document, position) {
        const offset = document.offsetAt(position);
        const analysis = await getDocumentAnalysis(document);
        const expansion = analysis.expansions.find(candidate => candidate.start <= offset && offset <= candidate.start + candidate.length);
        const artifacts = analysis.artifacts;
        const artifact = artifacts.find(candidate => candidate.start <= offset && offset <= candidate.start + candidate.length);
        const normalizedType = normalizedTypeAt(document, position, analysis);
        if (!expansion && !artifact && !normalizedType) return undefined;
        const markdown = new vscode.MarkdownString();
        if (expansion) {
          markdown.appendMarkdown(`**TS++ macro expansion: \`${expansion.macroName}\`**\n\n`);
          if (expansion.text.trim()) markdown.appendCodeblock(expansion.text, "typescript");
          else markdown.appendMarkdown("This is a validation-only macro; it emits no statements.");
        }
        if (artifact) {
          if (expansion) markdown.appendMarkdown("\n\n---\n\n");
          const icon = artifact.status === "proved" ? "✓" : artifact.status === "failed" ? "✗" : "?";
          markdown.appendMarkdown(`**${icon} TS++ verification: ${artifact.status}**\n\n${artifact.message}`);
          if (artifact.counterexample) markdown.appendMarkdown(`\n\n**Counterexample**\n\n\`${artifact.counterexample.replaceAll("`", "\\`")}\``);
        }
        if (normalizedType) {
          if (expansion || artifact) markdown.appendMarkdown("\n\n---\n\n");
          const normalized = normalizedType.normalized.replace(/\s+/g, " ").trim().replaceAll("`", "\\`");
          markdown.appendMarkdown(`Normalized: \`${normalized}\` · ${normalizedType.classification.label}: \`${normalizedType.classification.text}\``);
        }
        if (normalizedType && !expansion && !artifact) return new vscode.Hover(markdown, normalizedType.range);
        const start = expansion?.start ?? artifact.start;
        const length = expansion?.length ?? artifact.length;
        return new vscode.Hover(
          markdown,
          new vscode.Range(
            document.positionAt(start),
            document.positionAt(start + length),
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
      if (expandedDocument.languageId !== "tspp") {
        expandedDocument = await vscode.languages.setTextDocumentLanguage(expandedDocument, "tspp");
      }
      await vscode.window.showTextDocument(expandedDocument, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: true,
      });
    }),
    vscode.commands.registerCommand("tspp.showVerificationSmt", async () => {
      const document = vscode.window.activeTextEditor?.document;
      if (!document || document.uri.scheme !== "file" || path.extname(document.fileName).toLowerCase() !== ".tspp") return;
      const artifacts = await getVerificationArtifacts(document);
      if (!artifacts.length) {
        await vscode.window.showInformationMessage("This file contains no formal-verification obligations.");
        return;
      }
      const smtUri = vscode.Uri.from({
        scheme: "tspp-smt",
        path: document.uri.path.replace(/\.tspp$/i, ".verification.smt2"),
        query: `source=${encodeURIComponent(document.uri.toString())}`,
      });
      const sortedArtifacts = [...artifacts].sort((left, right) => left.start - right.start);
      const sections = sortedArtifacts.map((artifact, index) => {
        const start = document.positionAt(artifact.start);
        const end = document.positionAt(artifact.start + Math.max(artifact.length - 1, 0));
        const lineRange = start.line === end.line ? `${start.line + 1}` : `${start.line + 1}-${end.line + 1}`;
        const counterexample = artifact.counterexample ? `; counterexample: ${artifact.counterexample.replaceAll("\n", "\n; ")}\n` : "";
        const model = artifact.model ? `; raw Z3 model:\n; ${artifact.model.replaceAll("\n", "\n; ")}\n` : "";
        const header = [
          "; ============================================================================",
          `; obligation ${index + 1}/${sortedArtifacts.length}: ${artifact.name}`,
          `; source lines: ${lineRange} (columns ${start.character + 1}-${end.character + 1})`,
          `; kind: ${artifact.kind}`,
          `; obligation: ${artifact.obligation}`,
          `; status: ${artifact.status}`,
          `; ${artifact.message.replaceAll("\n", "\n; ")}`,
          "; ============================================================================",
          "",
        ].join("\n");
        return header + counterexample + model + artifact.replayableSmtLib.trimEnd();
      });
      const header = `; All verification SMT-LIB for ${path.basename(document.fileName)}\n; ${sortedArtifacts.length} proof obligation${sortedArtifacts.length === 1 ? "" : "s"}, ordered by source line.\n\n`;
      smtDocuments.set(smtUri.toString(), header + sections.join("\n\n") + "\n");
      smtDocumentChanges.fire(smtUri);
      let smtDocument = await vscode.workspace.openTextDocument(smtUri);
      const languageId = (await vscode.languages.getLanguages()).includes("smt") ? "smt" : "plaintext";
      if (smtDocument.languageId !== languageId) smtDocument = await vscode.languages.setTextDocumentLanguage(smtDocument, languageId);
      await vscode.window.showTextDocument(smtDocument, { viewColumn: vscode.ViewColumn.Beside, preview: true });
    }),
    vscode.workspace.onDidChangeTextDocument(() => {
      macroExpansionCache.clear();
    }),
    vscode.workspace.onDidSaveTextDocument(() => {
      macroExpansionCache.clear();
    }),
  );

  async function openExample(example, viewColumn = vscode.ViewColumn.Active) {
    const document = await vscode.workspace.openTextDocument(path.join(example.directory, example.entry));
    await vscode.window.showTextDocument(document, { viewColumn, preview: false });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("tspp.openHigherKindedTypesExample", () => openExample(examples[0])),
    vscode.commands.registerCommand("tspp.openDependentTypesExample", () => openExample(examples[1])),
    vscode.commands.registerCommand("tspp.openNewtypeAndDataExample", () => openExample(examples[2])),
    vscode.commands.registerCommand("tspp.openMacrosExample", () => openExample(examples[3])),
    vscode.commands.registerCommand("tspp.openFormalContractsExample", () => openExample(examples[4])),
    vscode.commands.registerCommand("tspp.openTypeComputationExample", () => openExample(examples[5])),
    vscode.commands.registerCommand("tspp.openTypescriptInteropExample", () => openExample(examples[6])),
    vscode.commands.registerCommand("tspp.openAllExamples", async () => {
      for (const [index, example] of examples.entries()) {
        await openExample(example, index < 3 ? index + 1 : vscode.ViewColumn.Beside);
      }
    }),
    vscode.commands.registerCommand("tspp.pickExample", async () => {
      const selection = await vscode.window.showQuickPick(
        [
          { label: "All examples", description: "Open examples 01 through 07", command: "tspp.openAllExamples" },
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

async function deactivate() {
  if (languageClient) {
    await languageClient.stop();
    languageClient = undefined;
  }
}

module.exports = { activate, deactivate };

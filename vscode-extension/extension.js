const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

function activate(context) {
  const repositoryRoot = path.resolve(context.extensionPath, "..");
  const compilerPath = path.join(repositoryRoot, "built", "local", "tsserver.js");
  const examplesRoot = path.join(repositoryRoot, "example");
  const examples = [
    {
      label: "01 — Higher-Kinded Types",
      description: "Kinds, type constructors, and universes",
      command: "tspp.openHigherKindedTypesExample",
      directory: path.join(examplesRoot, "01-higher-kinded-types"),
    },
    {
      label: "02 — Dependent Types",
      description: "A beginner-friendly introduction to native MLTT types",
      command: "tspp.openDependentTypesExample",
      directory: path.join(examplesRoot, "02-dependent-types"),
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

  async function openExample(example, viewColumn = vscode.ViewColumn.Active) {
    const document = await vscode.workspace.openTextDocument(path.join(example.directory, "index.tspp"));
    await vscode.window.showTextDocument(document, { viewColumn, preview: false });
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("tspp.openHigherKindedTypesExample", () => openExample(examples[0])),
    vscode.commands.registerCommand("tspp.openDependentTypesExample", () => openExample(examples[1])),
    vscode.commands.registerCommand("tspp.openAllExamples", async () => {
      await openExample(examples[0], vscode.ViewColumn.One);
      await openExample(examples[1], vscode.ViewColumn.Two);
    }),
    vscode.commands.registerCommand("tspp.pickExample", async () => {
      const selection = await vscode.window.showQuickPick(
        [
          { label: "All examples", description: "Open examples 01 and 02 side by side", command: "tspp.openAllExamples" },
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

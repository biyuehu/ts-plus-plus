const fs = require("fs");
const path = require("path");
const vscode = require("vscode");

function activate(context) {
  const repositoryRoot = path.resolve(context.extensionPath, "..");
  const compilerPath = path.join(repositoryRoot, "built", "local", "tsserver.js");
  const examplePath = path.join(repositoryRoot, "example", "01-higher-kinded-types", "index.tspp");

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "tspp.openHigherKindedTypesExample";
  context.subscriptions.push(status);

  if (!fs.existsSync(compilerPath)) {
    status.text = "$(error) TS++ compiler not built";
    status.tooltip = "Run npm run build:compiler in the repository, then restart this development host.";
    status.show();
    return;
  }

  status.text = "$(beaker) TS++";
  status.tooltip = `Using the repository compiler at ${compilerPath}`;
  status.show();

  context.subscriptions.push(
    vscode.commands.registerCommand("tspp.openHigherKindedTypesExample", async () => {
      const document = await vscode.workspace.openTextDocument(examplePath);
      await vscode.window.showTextDocument(document);
    }),
  );

  if (!vscode.window.activeTextEditor && fs.existsSync(examplePath)) {
    void vscode.commands.executeCommand("tspp.openHigherKindedTypesExample");
  }
}

function deactivate() {}

module.exports = { activate, deactivate };

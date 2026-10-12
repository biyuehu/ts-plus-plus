# TypeScript++ development extension

This repository-local extension is launched by the `TS++: Run HKT Example` F5 configuration. It verifies that the repository compiler exists, exposes a status-bar entry, and opens the first example in an Extension Development Host.

The example workspace configures VS Code's built-in TypeScript language features to use `built/local`. VS Code asks for confirmation before trusting a workspace TypeScript server; choose **Allow** the first time the development host opens.

The extension also applies the standard TypeScript arrow-operator scope to TS++ kind arrows that the built-in TypeScript TextMate grammar does not recognize yet.

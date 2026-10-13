# TS++ development extension

This repository-local extension powers the TS++ example experience in an Extension Development Host.

The root launch configuration offers three F5 targets:

- `TS++: Run All Examples` opens the `example` directory and shows both examples side by side;
- `TS++: Run Example 01 — Higher-Kinded Types` opens only the HKT example;
- `TS++: Run Example 02 — Dependent Types` opens only the dependent-types tutorial.

The status-bar item opens a quick picker, so users can switch examples without restarting the development host. The extension also verifies that the repository compiler exists and highlights TS++ `=>` kind arrows, `->` dependent-function arrows, and compile-time macro syntax.

Hovering a `macro fn(Target);` statement previews the formatted statements returned by that macro. The preview button in the editor title opens a read-only `*.expanded.tspp` document beside the source, showing the complete file after all macro calls have been replaced. Validation-only macros report that they emit no statements and disappear from the full-file preview.

Example workspace settings configure VS Code's built-in JS/TS compatibility layer to use the TS++ SDK in `built/local/lib`. VS Code asks for confirmation before trusting a workspace language server; choose **Allow** the first time a development host opens.

# TS++ development extension

This repository-local extension powers the TS++ example experience in an Extension Development Host.

The root launch configuration offers three F5 targets:

- `TS++: Run All Examples` opens the `example` directory and shows both examples side by side;
- `TS++: Run Example 01 — Higher-Kinded Types` opens only the HKT example;
- `TS++: Run Example 02 — Dependent Types` opens only the dependent-types tutorial.

The status-bar item opens a quick picker, so users can switch examples without restarting the development host. The extension also verifies that the repository compiler exists and highlights TS++ `=>` kind arrows and `->` dependent-function arrows.

Example workspace settings configure VS Code's built-in JS/TS compatibility layer to use the TS++ SDK in `built/local/lib`. VS Code asks for confirmation before trusting a workspace language server; choose **Allow** the first time a development host opens.

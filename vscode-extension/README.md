# TS++ development extension

This repository-local extension powers the TS++ example experience in an Extension Development Host.

The root launch configuration offers three F5 targets:

- `TS++: Run All Examples` opens the `example` directory and shows both examples side by side;
- `TS++: Run Example 01 — Higher-Kinded Types` opens only the HKT example;
- `TS++: Run Example 02 — Dependent Types` opens only the dependent-types tutorial.

The status-bar item opens a quick picker, so users can switch examples without restarting the development host. The extension also verifies that the repository compiler exists and highlights TS++ `=>` kind arrows, `->` dependent-function arrows, and compile-time macro syntax.

Hovering a `macro fn(Target);` statement previews the formatted statements returned by that macro. The preview button in the editor title opens a read-only `*.expanded.tspp` document beside the source, showing the complete file after all macro calls have been replaced. Validation-only macros report that they emit no statements and disappear from the full-file preview.

The extension registers `.tspp` as the independent `tspp` language and starts the repository's
`tspp-language-server`, which in turn uses the TS++ SDK in `built/local/lib`. Ordinary `.ts` and
`.tsx` files remain owned by VS Code's built-in TypeScript extension and keep their configured
TypeScript SDK.

# 01 — Higher-kinded types

This project demonstrates explicitly annotated unary type constructors and their use as first-class type arguments.

From the repository root, press F5 and choose `TS++: Run HKT Example` if prompted. The Extension Development Host opens this project and the example source automatically. On first use, choose **Allow** when VS Code asks whether it may use the workspace TypeScript version.

Hover `labels` in `index.tspp` to see `string[]` inference. Uncomment one of the final two lines to inspect normal type errors and kind-mismatch diagnostics.

You can also check or emit the project from this directory:

```powershell
npm run check
npm run emit-declarations
```

Declaration emit writes `dist/index.d.tspp`; ordinary `.ts` inputs continue to emit `.d.ts`.

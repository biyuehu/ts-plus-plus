# TypeScript interoperability

This example demonstrates the one-way source boundary and dual declaration package format.

- `src/index.tspp` imports `src/legacy.ts` and explicitly strengthens a TypeScript value with `as UserId`.
- A `.ts` source file cannot import a `.tspp` source file.
- Building `index.tspp` emits both `dist/index.d.tspp` and the TypeScript-compatible `dist/index.d.ts`.
- `package.json#tsppTypes` and the `tspp-types` export condition expose the full declaration to TS++ consumers, while `types` remains the compatibility declaration used by TypeScript.

Because conditional export keys are order-sensitive, `tspp-types` appears before `types` in `package.json`.

Run from this directory:

```powershell
pnpm build
pnpm check-ts-consumer
```

The consumer is compiled with the upstream TypeScript compiler. It sees the projected `UserId`, the discriminated `Lookup<T>` union, and the runtime constructors, but not TS++-only syntax.

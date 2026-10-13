# ts-plus-plus

**English** | [简体中文](README.zh.md)

> The design proposal in [#](https://github.com/biyuehu/ts-plus-plus/issues/2) is for demonstration only. It is not a plan, not a TODO, and not a commitment. Treat it as a preview of a possible direction rather than a roadmap.

ts-plus-plus is an experimental TypeScript-derived language. Language extensions are opt-in and are selected individually in `tsppconfig.json`.

Without `tsppconfig.json`, every TS++ feature is disabled and the compiler behaves like TypeScript; `.tspp` and `.d.tspp` files do not participate in project discovery or module resolution.

## Initialize a project

```sh
tspp --init
```

If the directory has no `tsconfig.json`, this creates one first. It then creates `tsppconfig.json` with `"extends": "./tsconfig.json"` without modifying an existing TypeScript config. The generated file records the compiler commit, lists every available feature with comments, and leaves all of them disabled.

Enable features manually:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "tsppFeatures": [
      "higherKindedTypes",
      "newtypeDeclarations",
      "dataDeclarations",
      "typeUniverses"
    ]
  }
}
```

Dependencies must also be listed explicitly. An unknown feature, duplicate feature, or missing dependency is a configuration error: compilation is rejected, and the compiler neither edits the file nor starts in a fallback mode.

## What a feature can change

Each feature is evaluated on two independent properties:

- **TypeScript superset**: existing TypeScript syntax, type checking, and runtime behavior remain compatible.
- **Transparent erasure**: the feature is implemented by removing type syntax only; it does not generate or change JavaScript runtime code.

A configured language remains a TypeScript superset only if every enabled feature preserves the first property. It remains transparently erasable only if every enabled feature preserves the second. Declaration-file preservation is intentionally not tracked as a separate property.

Current features:

| Feature | Provides | Explicit dependencies | TS superset | Transparent erasure |
| --- | --- | --- | --- | --- |
| `higherKindedTypes` | Higher-kinded parameters and first-class type constructors | — | Yes | Yes |
| `newtypeDeclarations` | `newtype` nominal type declarations and their constructors | — | Yes | Yes |
| `dataDeclarations` | `data` discriminated unions and variant constructors | — | Yes | Yes |
| `typeUniverses` | `Type0`, `Type1`, … and kind stratification | `higherKindedTypes` | Yes | Yes |
| `dependentFunctionTypes` | Pi types whose result can depend on a parameter | `typeUniverses` | Yes | Yes |
| `dependentFunctionInterop` | Assignment and calls between Pi types and TypeScript generic functions | `dependentFunctionTypes` | Yes | Yes |
| `naturalNumbers` | `Nat`, `Zero`, and `Succ` type-level naturals | `dependentFunctionTypes` | Yes | Yes |
| `naturalNumberAddition` | Reducible `NatAdd` | `naturalNumbers` | Yes | Yes |
| `naturalNumberElimination` | The dependent `NatElim` eliminator | `naturalNumbers` | Yes | Yes |
| `identityTypes` | `Eq` and `Refl` equality types and proofs | `dependentFunctionTypes` | Yes | Yes |
| `sigmaTypes` | `Sigma`, `Pair`, `First`, and `Second` | `dependentFunctionTypes` | Yes | Yes |

The generated configuration is the authoritative, compiler-version-specific feature guide. The project is still experimental; these classifications describe the listed implementation, not a permanent promise about future features.

## License

Apache License 2.0. tsplusplus is derived from Microsoft's TypeScript; the original license, copyright notices and `NOTICE` remain in place, and modified files will be marked as modified. "TypeScript" is a trademark of Microsoft Corporation.

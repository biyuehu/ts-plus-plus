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
      "macros",
      "formalContracts",
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
| `newtypeDeclarations` | `newtype` nominal type declarations and their constructors | — | Yes | No (emits runtime constructors) |
| `dataDeclarations` | `data` discriminated unions and variant constructors | — | Yes | No (emits runtime variant values and constructors) |
| `macros` | `macro function` declarations and compile-time `macro f(Target);` statement expansion | — | Yes | No (macro calls can replace emitted statements) |
| `formalContracts` | Z3-backed `requires`, `ensures`, and `while` invariants | — | Yes | Yes |
| `typeUniverses` | `Type0`, `Type1`, … and kind stratification | `higherKindedTypes` | Yes | Yes |
| `dependentFunctionTypes` | Pi types plus explicit `Lam`/`Ann` MLTT terms | `typeUniverses` | Yes | Yes |
| `dependentFunctionInterop` | Assignment and calls between Pi types and TypeScript generic functions | `dependentFunctionTypes` | Yes | Yes |
| `naturalNumbers` | `Nat`, `Zero`, and `Succ` type-level naturals | `dependentFunctionTypes` | Yes | Yes |
| `naturalNumberAddition` | Reducible `NatAdd` | `naturalNumbers` | Yes | Yes |
| `naturalNumberElimination` | The dependent `NatElim` eliminator | `naturalNumbers` | Yes | Yes |
| `identityTypes` | `Eq`, `Refl`, and `J` path induction | `dependentFunctionTypes` | Yes | Yes |
| `sigmaTypes` | `Sigma`, `Pair`, `First`, and `Second` | `dependentFunctionTypes` | Yes | Yes |

The generated configuration is the authoritative, compiler-version-specific feature guide. The project is still experimental; these classifications describe the listed implementation, not a permanent promise about future features.

## Formal contracts

Enable `formalContracts`, then attach contracts to a function and invariants to `while` statements:

```ts
function sumTo(n: bigint) with {
  requires: n >= 0n;
  ensures: result === n;
}: bigint {
  let current = 0n;
  while (current < n) with {
    invariant: current >= 0n;
    invariant: current <= n;
  } {
    current += 1n;
  }
  return current;
}
```

The initial subset covers `boolean` and `bigint`, local variables, assignments, branches, multiple returns, invariant-annotated loops, and `requires` checks at direct call sites that resolve to project function declarations. Calls inside verified functions use the caller's assumptions and current symbolic path facts. `number` is available only after adding `numberModel: "mathematical-real";` to the function contract; this deliberately models numbers as mathematical reals rather than JavaScript IEEE-754 values.

Every obligation is reported as `proved`, `failed`, `unknown`, or `error`. Unsupported syntax and unavailable solver environments are compilation errors with an `unknown` result, never a successful proof. `Program.getVerificationArtifacts()` exposes the exact solver input, replayable SMT-LIB, status, counterexample model, and source location. The development extension's **TS++: Show Verification SMT-LIB** command opens that replayable input beside the source.

## License

Apache License 2.0. tsplusplus is derived from Microsoft's TypeScript; the original license, copyright notices and `NOTICE` remain in place, and modified files will be marked as modified. "TypeScript" is a trademark of Microsoft Corporation.

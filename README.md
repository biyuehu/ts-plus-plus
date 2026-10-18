# ts-plus-plus

**English** | [简体中文](README.zh.md)

> The design proposal in [#](https://github.com/biyuehu/ts-plus-plus/issues/2) is for demonstration only. It is not a plan, not a TODO, and not a commitment. Treat it as a preview of a possible direction rather than a roadmap.

ts-plus-plus is an experimental TypeScript-derived language. It supports many powerful type features, extending the capabilities of TypeScript's type system, while also designing modern language features at the value level.

<!-- markdownlint-disable -->

<div align="center">
<img width="180px" src="./vscode-extension/tspp.svg" />
</div>

<!-- markdownlint-enable -->

Language extensions are opt-in and are selected individually in `tsppconfig.json`. Without `tsppconfig.json`, every TS++ feature is disabled and the compiler behaves like TypeScript; `.tspp` and `.d.tspp` files do not participate in project discovery or module resolution.

## Contributors

<!-- markdownlint-disable -->

<a href="https://github.com/biyuehu/ts-plus-plus/graphs/contributors">
  <img src="assets/contributors.svg" alt="Contributors" />
</a>

<!-- markdownlint-enable -->

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
      "refinementTypes",
      "typeUniverses"
    ]
  }
}
```

Dependencies must also be listed explicitly. An unknown feature, duplicate feature, or missing dependency is a configuration error: compilation is rejected, and the compiler neither edits the file nor starts in a fallback mode.

## TypeScript interoperability

TS++ uses TypeScript as its compatibility and FFI boundary:

- The TS++ compiler accepts `.ts`, `.js`, and `.tspp` sources. A `.tspp` source may import TypeScript or JavaScript source and may use ordinary TypeScript assertions when explicitly strengthening a boundary value.
- A `.ts` or `.js` source cannot import `.tspp` or `.d.tspp` source. It may still consume a compiled TS++ package through that package's JavaScript and `.d.ts` compatibility surface.
- Declaration emit for `.ts` remains `.d.ts`. Declaration emit for `.tspp` writes both a full-fidelity `.d.tspp` and a TypeScript-compatible `.d.ts` projection.
- TS++ package consumers prefer `package.json#tsppTypes` and the `tspp-types` exports condition. TypeScript consumers continue to use `types` and the standard `types` exports condition.

Conditional export keys are order-sensitive, so place `tspp-types` before `types` as shown below.

```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "tsppTypes": "./dist/index.d.tspp",
  "exports": {
    ".": {
      "tspp-types": "./dist/index.d.tspp",
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  }
}
```

The compatibility declaration is a conservative projection, not a textual rename. `newtype` becomes its underlying TypeScript type plus a constructor signature, `data` becomes a discriminated union plus variant declarations, contracts and macro-only declarations are omitted, dependent functions keep their callable domain but use an `unknown` result, and TS++ type computations or higher-kinded operations that TypeScript cannot express become `unknown`. The `.d.ts` output is required to form a closed graph that never references `.d.tspp`.

See [`example/07-typescript-interop`](./example/07-typescript-interop) for a mixed-source library and an upstream TypeScript consumer.

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
| `standardLibraryPredicates` | Built-in numeric predicates `isEven`, `isOdd`, `isPositive`, `isNonNegative`, `isZero`, `divides`, and `between`; `number` requires `numberModel: "mathematical-real"` | `formalContracts` | Yes | Yes |
| `refinementTypes` | Z3-verified predicates on structural type aliases | `formalContracts` | Yes | Yes |
| `typeComputation` | Type-level `let X = T in U` bindings, pattern matching `match T { ... }`, and type lambdas `<T> =>> Body` | — | Yes | Yes |
| `typeUniverses` | `Type0`, `Type1`, … and kind stratification | `higherKindedTypes` | Yes | Yes |
| `dependentFunctionTypes` | Pi types plus explicit `Lam`/`Ann` MLTT terms | `typeUniverses` | Yes | Yes |
| `dependentFunctionInterop` | Assignment and calls between Pi types and TypeScript generic functions | `dependentFunctionTypes` | Yes | Yes |
| `typeMatching` | Exact `IfType`, ordered `TypeMatch`, and case-local `infer` captures using generic-constructor identity | `dependentFunctionTypes` | Yes | Yes |
| `naturalNumbers` | `Nat`, `Zero`, and `Succ` type-level naturals | `dependentFunctionTypes` | Yes | Yes |
| `naturalNumberAddition` | Reducible `NatAdd` | `naturalNumbers` | Yes | Yes |
| `naturalNumberElimination` | The dependent `NatElim` eliminator | `naturalNumbers` | Yes | Yes |
| `booleans` | `Bool`, `True`, and `False` type-level booleans | `dependentFunctionTypes` | Yes | Yes |
| `booleanElimination` | The dependent `BoolElim` eliminator and `If` | `booleans` | Yes | Yes |
| `identityTypes` | `Eq`, `Refl`, and `J` path induction | `dependentFunctionTypes` | Yes | Yes |
| `sigmaTypes` | `Sigma`, `Pair`, `First`, and `Second` | `dependentFunctionTypes` | Yes | Yes |

The generated configuration is the authoritative, compiler-version-specific feature guide. The project is still experimental; these classifications describe the listed implementation, not a permanent promise about future features.

## Verification architecture

Contracts, control-flow facts, and refinement predicates lower to a solver-independent Verification IR. The SMT backend is the only layer that serializes that IR to SMT-LIB and invokes Z3, so TypeScript's own control-flow analysis is reused as a source of facts rather than replaced. Macro and verification work share a bounded analysis-worker queue, propagate cancellation and timeout outcomes, and reuse successful content-addressed obligations across incremental programs.

The MLTT core keeps its own terms, normalization, and definitional equality. A future MLTT refinement bridge should translate only its decidable arithmetic/equality fragment into Verification IR; it should not merge the MLTT core with the SMT representation.

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

The current subset covers `boolean`, `bigint`, and `string`, local variables, assignments, branches, `switch`, multiple returns, invariant-annotated loops, and `requires` checks at direct call sites that resolve to project function declarations. Records, record literals, closed discriminated unions with a unique string `_tag`, TS++ `data` constructors, and recursive algebraic data are lowered from the types and control-flow narrowing already computed by the TypeScript checker into Verification IR product/sum types and then into Z3 datatypes; the verifier does not implement a competing version of TypeScript narrowing. Optional properties, index signatures, and open unions currently produce an explicit `unknown`. Calls inside verified functions use the caller's assumptions and current symbolic path facts. `number` is available only after adding `numberModel: "mathematical-real";` to the function contract; this deliberately models numbers as mathematical reals rather than JavaScript IEEE-754 values.

Every obligation is reported as `proved`, `failed`, `unknown`, or `error`, with task outcomes distinguishing cancellation and timeout. Unsupported syntax and unavailable solver environments are compilation errors with an `unknown` result, never a successful proof. `Program.getVerificationArtifacts()` exposes the exact solver input, replayable SMT-LIB, status, decoded source-level counterexample, raw model, and source location. The development extension's **TS++: Show Verification SMT-LIB** command opens that replayable input beside the source.

## Type computation: let-in, match, and type lambdas

Enable `typeComputation`, then use local type bindings, pattern matching, and anonymous type-level functions:

```typescript
// 1. Scoped local let-in bindings
type UserResponse<T> = let Payload = { data: T; timestamp: number } in {
  response: Payload;
  backup: Payload;
};

// 2. Type-level pattern matching (structural infer, ADT constructors, primitives, and literals)
type Classify<T> = match T {
  [infer Head, ...infer Tail]: { head: Head; tail: Tail },
  Array<infer U>: [U, "array"],
  1: "one",
  string: "is-string",
  _: "other"
};

// 3. Anonymous type lambdas (<T> =>> Body)
type Id = <T> =>> T;
type Swap = <A, B> =>> [B, A];

type Swapped = Swap<string, number>; // [number, string]
```

Type lambdas integrate with higher-kinded parameters. A lambda `<T> =>> Body` has kind `Type => Type` and can be passed anywhere a type constructor is expected:

```typescript
// Require typeComputation + higherKindedTypes.
type Apply<F: Type => Type, X> = F<X>;

type Doubled = Apply<<T> =>> [T, T], boolean>; // [boolean, boolean]
```

The lambda body may reference any type in scope. All type computation syntax is erased and produces no JavaScript output.

## License

Apache License 2.0. tsplusplus is derived from Microsoft's TypeScript; the original license, copyright notices and `NOTICE` remain in place, and modified files will be marked as modified. "TypeScript" is a trademark of Microsoft Corporation.

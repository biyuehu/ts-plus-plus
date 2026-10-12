# ts-plus-plus

**English** | [简体中文](README.zh.md)

> A superset of TypeScript 6.0 that extends the **type system** — higher-kinded types, nominal types, GADTs, compile-time types — and erases back to plain JavaScript.

**Status: design phase.** The compiler is a fork of TypeScript 6.0. Repository bootstrap and `.tspp` source-file recognition have begun; the language features described below are not implemented yet. This README is the design draft we want to build against. Every feature carries a label:

- `[decided]` — settled, we are building it this way
- `[draft]` — proposed syntax or semantics, open for review
- `[exploring]` — an idea we want to investigate, may change or disappear

The npm package is `ts-plus-plus`; its compiler command is `tspp` so it can coexist with TypeScript's `tsc` in the same project.

---

## Why

TypeScript's type system is remarkable, but there are things it cannot express, and the workarounds are well known:

| You want                                                 | In TypeScript today                                        | In ts-plus-plus                                          |
| -------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| Abstract over `Option`, `Array`, `Promise` (a `Functor`) | URI-keyed lookup tables, `interface HKT { ... }` encodings | `F: Type => Type`                                        |
| Two `string` IDs that must never be mixed up             | "Brand" intersections: `string & { __brand: "UserId" }`    | `newtype UserId = string`                                |
| A type that depends on which constructor you matched     | Overloads and casts                                        | GADTs with real type refinement in `match`               |
| Type-level programming                                   | Conditional types, `infer`, recursion tricks               | Ordinary functions over types, evaluated at compile time |

The goal is not new syntax for its own sake. The goal is **type-level power that cannot be reproduced in TypeScript with a comparable amount of code**.

---

## Principles (Stage 1)

1. **Superset of TypeScript 6.0** `[decided]`
   Any program that `tsc` 6.0 compiles, ts-plus-plus compiles with the same meaning. Later TypeScript versions are out of scope. We intend to enforce this in CI by running the upstream test suite: its baselines must not change.

2. **We extend types, and types are erased** `[decided]`
   After compilation the output is plain JavaScript, run by any JavaScript runtime. No runtime library is required.

3. **Emit tiers** `[draft]`
   Not every feature is a pure type-level extension, so we classify them honestly:

   | Tier  | What it means                                                                                | Examples                                                           |
   | ----- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
   | **A** | Types only. Deleting the types yields valid JS.                                              | kinds / HKT, nominal checking, GADT refinement, compile-time types |
   | **B** | New value-level syntax whose lowering depends **only on syntax**, never on type information. | `data` constructors, `match`                                       |
   | **C** | Emit depends on type information.                                                            | trait instance resolution, dot-call of trait methods               |

   Tier C is an explicit exception to the erasure principle and needs its own RFC. The guardrail we propose: **a file must be compilable knowing only the declaration outputs of the modules it imports** (no whole-program inference), so per-file parallel builds stay possible.

4. **Written in TypeScript** `[decided]`
   The compiler stays a TypeScript codebase.

5. **New syntax is contextual** `[draft]`
   `data`, `match`, `newtype`, `trait`, `impl` and friends are contextual keywords. Identifiers with those names keep working in existing code.

6. **The `.tspp` file extension for ts-plus-plus syntax** `[decided]`
   `.ts` keeps strict TypeScript 6.0 semantics, so existing tools (ESLint, Prettier, editors) are unaffected by us. ts-plus-plus-only syntax lives in `.tspp` files; the compiler accepts both `.ts` and `.tspp`.

---

## A taste of the language

All syntax below is draft unless labelled otherwise.

### Nominal types: `newtype` `[draft]`

```ts
newtype UserId  = string
newtype OrderId = string

const u = UserId("u_1")     // erased: compiles to "u_1"
const o: OrderId = u        // error: UserId is not OrderId
const s: string = u         // allowed: a newtype converts to its underlying type
```

A `newtype` has exactly one underlying type and **no runtime representation**. Because of that, two newtypes over the same underlying type cannot be told apart at runtime, so `match` over `UserId | OrderId` is a compile error.

### Algebraic data types: `data` `[decided: nominal,`\_tag`representation]`

```ts
data Option<A> = None | Some(value: A)

data Shape =
  | Circle(radius: number)
  | Rect(width: number, height: number)
```

`data` types are **nominal**: two declarations with the same shape are different types. Variants are subtypes of their `data` type. Values are plain objects carrying a `_tag`, so they survive JSON, `structuredClone` and `postMessage`:

```js
// emitted (illustrative)
const None = { _tag: "None" };
const Some = (value) => ({ _tag: "Some", value });
```

We deliberately chose plain data over sealed-class hierarchies: no prototype chain, no `instanceof`, no methods stored on values. Behaviour lives in `impl` blocks (below).

### Pattern matching with exhaustiveness: `match` `[draft]`

```ts
function area(s: Shape): number {
  return match (s) {
    Circle(r)  => Math.PI * r * r,
    Rect(w, h) => w * h,
  }
}
```

Forget a case and you get a diagnostic naming what is missing:

```text
error: non-exhaustive match, missing: Rect(_, _)
```

`match` is an expression and lowers to a decision tree (`if` / `switch`). It also works on ordinary TypeScript discriminated unions, so existing code can adopt it without conversion.

### Methods on data: inherent `impl` `[decided: nominal types only]`

```ts
impl<A> Option<A> {
  getOrElse(self, fallback: A): A {
    return match (self) {
      Some(a) => a,
      None    => fallback,
    }
  }
}

Some(1).getOrElse(0)        // dot syntax, resolved statically
Option.getOrElse(x, 0)      // qualified path, usable as a function value
```

An inherent `impl` is allowed only for nominal types (`data`, and — proposed — `newtype`) and only in the package that declares the type. Structural types such as `{ x: number }` have no identity to attach methods to. Methods are plain functions: nothing is stored on the value, so `data` stays pure data.

### Traits with the orphan rule `[decided: orphan rule]`

```ts
trait Eq<A> {
  eq(self: A, other: A): boolean
}

impl Eq<number> {
  eq(self, other) { return self === other }
}

impl<A> Eq<Option<A>> where Eq<A> {
  eq(self, other) {
    return match ([self, other]) {
      [None, None]       => true,
      [Some(x), Some(y)] => x.eq(y),
      _                  => false,
    }
  }
}

function contains<A>(xs: A[], x: A): boolean where Eq<A> {
  return xs.some(y => y.eq(x))
}
```

- A method whose first parameter is `self` can be called with dot syntax. Free functions can never be called that way, which keeps one style per kind of operation. This is our "partial UFCS".
- Resolution order: the value's own members first, then inherent `impl` methods, then methods of traits that are **in scope**. Ambiguity is an error.
- An instance is legal only if the trait or the head type constructor is defined in the current package. `newtype` is the escape hatch for "same type, different instance".
- No overlapping instances; instances are globally coherent.

Instance resolution inserts dictionary arguments into the emitted code, which makes this a **Tier C** feature (see Principles).

### Higher-kinded types `[decided:`Type`kinds, no`\_`placeholder]`

```ts
trait Functor<F: Type => Type> {
  map<A, B>(self: F<A>, f: (a: A) => B): F<B>
  pure<A>(a: A): F<A>
}

impl Functor<Option> {
  map(self, f) { return match (self) { Some(a) => Some(f(a)), None => None } }
  pure(a)      { return Some(a) }
}

data Result<E, A> = Err(error: E) | Ok(value: A)

impl<E> Functor<Result<E>> {      // partial application: omit trailing type arguments
  // ...
}

function double<F: Type => Type>(fa: F<number>): F<number> where Functor<F> {
  return fa.map(x => x * 2)
}
```

Kinds are curried (`Type => Type => Type`), so partial application is just omitting trailing arguments. Fixing a non-trailing parameter needs a type-level lambda. Kinds can usually be inferred, so most code never writes one. This is a pure Tier A feature: nothing is emitted.

### GADTs `[draft]`

```ts
data Expr<A> =
  | Num(value: number): Expr<number>
  | Bool(value: boolean): Expr<boolean>
  | Add(left: Expr<number>, right: Expr<number>): Expr<number>
  | If(cond: Expr<boolean>, onTrue: Expr<A>, onFalse: Expr<A>): Expr<A>

function evaluate<A>(e: Expr<A>): A {
  return match (e) {
    Num(n)         => n,                  // here A = number
    Bool(b)        => b,                  // here A = boolean
    Add(l, r)      => evaluate(l) + evaluate(r),
    If(c, t, f)    => evaluate(c) ? evaluate(t) : evaluate(f),
  }
}
```

Each branch of a `match` introduces local type equalities. This is the hardest part of the checker work.

### First-class types `[exploring]`

Types as values that can be passed to, computed by and returned from functions — evaluated **at compile time only** and fully erased, in the spirit of Zig's `comptime`:

```ts
comptime function Pair(A: Type, B: Type): Type {
  return type { first: A; second: B }
}

type P = Pair(string, number)   // { first: string; second: number }
```

Existing `type`, conditional types, `infer` and mapped types stay as they are and act as the primitives the new evaluator calls into, so there is a single implementation of type semantics. Everything here, including the syntax, is open.

### Also under discussion `[exploring]`

- Expression-oriented `if` and block expressions (`const x = if (c) a else b`); `while`/`for` stay statements.
- A `use` sugar (from Gleam / Koka's `with`) that turns the rest of a block into a callback argument.

---

## Roadmap

**Stage 1 — add, never break.** Everything is additive. Gate for every milestone: the upstream TypeScript 6.0 test baselines do not change.

| Milestone | Scope                                                                                |
| --------- | ------------------------------------------------------------------------------------ |
| M0        | Repository bootstrap, naming, conformance gate in CI, contributor docs               |
| M1        | Nominal types: `newtype`, `data`; `match` with exhaustiveness checking               |
| M2        | Higher-kinded types: kind system, type application, inference                        |
| M3        | Inherent `impl`; traits with the orphan rule; dot-call of trait methods (Tier C RFC) |
| M4        | GADTs                                                                                |
| M5        | First-class (compile-time) types                                                     |

**Stage 2 — clean up, behind an edition flag.** Once Stage 1 is stable, a separate opt-in edition (never a flag day) starts dropping historical baggage: legacy `var`, `with`, `arguments`, the quirks of `enum` and `namespace`, loose equality, implicit `any`, the `null`/`undefined` split, and the older type-level syntax in favour of the new primitives. Old projects keep compiling as they are today.

---

## Open problems

We would rather list these than hide them:

- **Declaration output for plain TypeScript consumers.** Nominal types cannot be expressed in a plain `.d.ts` without loss; a branded-structural fallback is one option.
- **Nominal identity across duplicate packages.** Two copies of one package in `node_modules` must not turn into "same name, incompatible types".
- **Tooling.** Anything that depends on type information at emit time is hard for per-file transpilers. Tier C is where this bites.
- **Variance annotations** for abstract type constructors now that the `F<out _>` placeholder form is not used.
- **Instance visibility and coherence** details beyond the orphan rule.

---

## FAQ

**Why fork TypeScript 6.0 instead of the native (Go) port?**
6.0 is the last release of the JavaScript-based compiler, which is a codebase we can hack on in TypeScript itself. The cost is real: upstream is moving to the native implementation, so we will not get its fixes for free. To keep that door open, language semantics will be specified through documents and tests rather than only through this implementation.

**Why `_tag` objects and not classes?**
Plain data survives JSON, `structuredClone` and message passing, interoperates with existing discriminated unions, and keeps the runtime model trivial.

**Why `newtype` when `data` can wrap a value?**
A single-variant `data` is a boxed `{ _tag, value }`. A `newtype` is erased and costs nothing at runtime. The price is that it cannot be distinguished from its underlying value at runtime.

**Is this just syntax sugar?**
Some of it is, and we say so (the Tier B features). The reason to exist is the Tier A features, which TypeScript cannot express today.

---

## Relationship to other projects

- **TypeScript** — we are a fork of the 6.0 release line. We are not affiliated with or endorsed by Microsoft.
- **TS+ (Effect)** — an earlier, unrelated experimental TypeScript fork from the Effect team, published as `@tsplus/*`, which they later abandoned and wrote up in [a post-mortem](https://effect.website/blog/ts-plus-postmortem). Its main lessons — emit that depends on type information and a replacement `tsc` clash with modern per-file build tools, and changing the meaning of `.ts` files is a bad idea — shaped the principles above. The projects have similar names but use different npm package names; our compiler command is `tspp`, not `tsc`, so both compilers can coexist in one project.
- **Inspirations** — Haskell and Scala (type classes, HKT), Rust (orphan rule, inherent `impl`), Zig (`comptime`), Gleam and Koka (`use` / `with`), OCaml and F# (ADTs, pattern matching).

---

## Contributing

The project is young, so the most valuable contributions right now are about **design and verification**, not volume of code:

- Review and challenge the drafts above. Design discussions happen as RFCs in `rfcs/` (template to come); each `[draft]` and `[exploring]` item will get one.
- Build a corpus of test programs: things TypeScript cannot express today, and TypeScript 6.0 programs that must keep their meaning.
- Help with the compiler work for M0 and M1: parser support for the new contextual keywords, binder and checker rules for nominal types, the decision-tree lowering for `match`.

Build instructions are inherited from upstream TypeScript 6.0 (`npm ci`, then the `hereby` tasks in `Herebyfile.mjs`); a ts-plus-plus-specific guide will arrive with M0. After installing the package, invoke the compiler with `npx tspp`. See `CONTRIBUTING.md` once it exists.

---

## License

Apache License 2.0. ts-plus-plus is derived from Microsoft's TypeScript; the original license, copyright notices and `NOTICE` remain in place, and modified files will be marked as modified. "TypeScript" is a trademark of Microsoft Corporation.

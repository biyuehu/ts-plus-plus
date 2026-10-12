# ts-plus-plus

[English](README.md) | **简体中文**

> TypeScript 6.0 的超集，专注于扩展**类型系统**：高阶类型、名义类型、GADT、编译期类型，编译后擦除为纯 JavaScript。

**状态：设计阶段。** 编译器目前是 TypeScript 6.0 的 fork。仓库初始化和 `.tspp` 源文件识别已经开始；下文描述的语言特性尚未实现。本文是我们打算照着去建设的设计草案，每个特性都带有标签：

- `[已决定]`：已经敲定，会按此方式实现
- `[草案]`：已提出语法或语义，欢迎评审
- `[探索中]`：想要研究的想法，可能会改动甚至放弃

npm 包名为 `ts-plus-plus`；编译器命令为 `tspp`，以便与 TypeScript 的 `tsc` 在同一项目中共存。

---

## 为什么要做

TypeScript 的类型系统相当出色，但有些东西它表达不了，而变通方案大家都很熟悉：

| 你想要                                              | 今天的 TypeScript                                     | ts-plus-plus                       |
| --------------------------------------------------- | ----------------------------------------------------- | ---------------------------------- |
| 对 `Option`、`Array`、`Promise` 做抽象（`Functor`） | 以 URI 为键的查表、`interface HKT { ... }` 之类的编码 | `F: Type => Type`                  |
| 两种绝不能混用的 `string` ID                        | "品牌"交叉类型：`string & { __brand: "UserId" }`      | `newtype UserId = string`          |
| 类型取决于你匹配到了哪个构造器                      | 重载加类型断言                                        | GADT，在 `match` 中真正做类型细化  |
| 类型层编程                                          | 条件类型、`infer`、递归技巧                           | 作用于类型的普通函数，在编译期求值 |

目标不是为了新语法而新语法，而是**提供 TypeScript 用同等代码量无法复现的类型层能力**。

---

## 原则（Stage 1）

1. **TypeScript 6.0 的超集** `[已决定]`
   任何 `tsc` 6.0 能编译的程序，ts-plus-plus 也能编译，且含义不变。更新的 TypeScript 版本不在范围内。我们打算在 CI 中运行上游测试套件来保证这一点：其基线不得发生变化。

2. **我们扩展类型，类型会被擦除** `[已决定]`
   编译产物是普通 JavaScript，可由任何 JavaScript 运行时运行，不需要任何运行时库。

3. **emit 分档** `[草案]`
   并非所有特性都是纯类型层的扩展，所以我们如实分类：

   | 档    | 含义                                                 | 例子                                        |
   | ----- | ---------------------------------------------------- | ------------------------------------------- |
   | **A** | 只涉及类型。删掉类型就是合法的 JS。                  | kind / HKT、名义检查、GADT 细化、编译期类型 |
   | **B** | 新增值层语法，但降级**只依赖语法**，不依赖类型信息。 | `data` 构造器、`match`                      |
   | **C** | emit 依赖类型信息。                                  | trait 实例解析、trait 方法的点调用          |

   Tier C 是对擦除原则的明确例外，需要单独的 RFC。我们提出的护栏是：**一个文件必须能仅凭其导入模块的声明产物完成编译**（不做整程序推断），从而保留逐文件并行构建的可能。

4. **用 TypeScript 编写** `[已决定]`
   编译器保持为 TypeScript 代码库。

5. **新语法使用上下文关键字** `[草案]`
   `data`、`match`、`newtype`、`trait`、`impl` 等都是上下文关键字，已有代码中同名的标识符照常可用。

6. **ts-plus-plus 语法使用 `.tspp` 文件扩展名** `[已决定]`
   `.ts` 保持严格的 TypeScript 6.0 语义，因此现有工具（ESLint、Prettier、编辑器）不受影响。ts-plus-plus 专有语法放在 `.tspp` 文件中；编译器同时接受 `.ts` 和 `.tspp`。

---

## 语言速览

以下所有语法除特别标注外均为草案。

### 名义类型：`newtype` `[草案]`

```ts
newtype UserId  = string
newtype OrderId = string

const u = UserId("u_1")     // 被擦除：编译为 "u_1"
const o: OrderId = u        // 报错：UserId 不是 OrderId
const s: string = u         // 允许：newtype 可转换为其底层类型
```

`newtype` 有且仅有一个底层类型，**没有运行时表示**。因此，底层类型相同的两个 newtype 在运行时无法区分，对 `UserId | OrderId` 做 `match` 是编译错误。

### 代数数据类型：`data` `[已决定：名义类型，运行时用 _tag 表示]`

```ts
data Option<A> = None | Some(value: A)

data Shape =
  | Circle(radius: number)
  | Rect(width: number, height: number)
```

`data` 类型是**名义的**：结构相同的两个声明是不同的类型。变体是其 `data` 类型的子类型。值是带 `_tag` 的普通对象，因此可以顺利通过 JSON、`structuredClone` 和 `postMessage`：

```js
// 编译输出（示意）
const None = { _tag: "None" };
const Some = (value) => ({ _tag: "Some", value });
```

我们有意选择纯数据而不是 sealed class 层级：没有原型链，没有 `instanceof`，值上也不存放方法。行为定义在 `impl` 块里（见下文）。

### 带穷尽性检查的模式匹配：`match` `[草案]`

```ts
function area(s: Shape): number {
  return match (s) {
    Circle(r)  => Math.PI * r * r,
    Rect(w, h) => w * h,
  }
}
```

漏掉某个分支时，诊断会指出缺少了什么：

```text
error: non-exhaustive match, missing: Rect(_, _)
```

`match` 是表达式，降级为决策树（`if` / `switch`）。它也适用于普通的 TypeScript 可辨识联合，所以已有代码无需转换就能使用。

### 数据上的方法：固有 `impl` `[已决定：仅限名义类型]`

```ts
impl<A> Option<A> {
  getOrElse(self, fallback: A): A {
    return match (self) {
      Some(a) => a,
      None    => fallback,
    }
  }
}

Some(1).getOrElse(0)        // 点语法，静态解析
Option.getOrElse(x, 0)      // 限定路径，可作为函数值使用
```

固有 `impl` 只允许用于名义类型（`data`，以及按提议还包括 `newtype`），并且只能写在声明该类型的包内。`{ x: number }` 这样的结构类型没有可以挂方法的身份。方法就是普通函数：值上不存放任何东西，`data` 保持为纯数据。

### 带孤儿规则的 trait `[已决定：孤儿规则]`

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

- 第一个参数是 `self` 的方法可以用点语法调用。普通函数永远不能这样调用，这样每一类操作只有一种写法。这就是我们的"不完全 UFCS"。
- 解析顺序：值自身的成员优先，其次是固有 `impl` 的方法，再次是**在作用域内**的 trait 的方法。出现歧义时报错。
- 只有当 trait 或实例头部的类型构造器定义在当前包内时，实例才合法。`newtype` 是"同一类型、不同实例"的逃生口。
- 不允许重叠实例，实例全局一致。

实例解析会把字典参数插入到输出代码中，因此这是 **Tier C** 特性（见原则）。

### 高阶类型 `[已决定：使用 Type 作 kind，不使用 _ 占位符]`

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

impl<E> Functor<Result<E>> {      // 部分应用：省略末尾的类型实参
  // ...
}

function double<F: Type => Type>(fa: F<number>): F<number> where Functor<F> {
  return fa.map(x => x * 2)
}
```

kind 是柯里化的（`Type => Type => Type`），所以部分应用就是省略末尾的实参。要固定非末尾的参数，需要类型层的 lambda。kind 通常可以推断，所以大多数代码根本不用写。这是纯 Tier A 特性：不产生任何输出。

### GADT `[草案]`

```ts
data Expr<A> =
  | Num(value: number): Expr<number>
  | Bool(value: boolean): Expr<boolean>
  | Add(left: Expr<number>, right: Expr<number>): Expr<number>
  | If(cond: Expr<boolean>, onTrue: Expr<A>, onFalse: Expr<A>): Expr<A>

function evaluate<A>(e: Expr<A>): A {
  return match (e) {
    Num(n)         => n,                  // 此处 A = number
    Bool(b)        => b,                  // 此处 A = boolean
    Add(l, r)      => evaluate(l) + evaluate(r),
    If(c, t, f)    => evaluate(c) ? evaluate(t) : evaluate(f),
  }
}
```

`match` 的每个分支都会引入局部类型等式。这是 checker 工作中最难的部分。

### 一等类型 `[探索中]`

类型是可以传给函数、由函数计算并返回的值，**只在编译期求值**并完全擦除，思路类似 Zig 的 `comptime`：

```ts
comptime function Pair(A: Type, B: Type): Type {
  return type { first: A; second: B }
}

type P = Pair(string, number)   // { first: string; second: number }
```

现有的 `type`、条件类型、`infer` 和映射类型保持不变，并作为新求值器调用的原语，所以类型语义只有一套实现。这里的一切，包括语法，都是开放的。

### 同样在讨论中 `[探索中]`

- 表达式化的 `if` 和块表达式（`const x = if (c) a else b`）；`while`/`for` 仍是语句。
- 一种 `use` 糖（来自 Gleam，以及 Koka 的 `with`），把块的剩余部分变成回调实参。

---

## 路线图

**Stage 1：只加不破坏。** 一切都是增量的。每个里程碑的门禁：上游 TypeScript 6.0 的测试基线不得变化。

| 里程碑 | 范围                                                                 |
| ------ | -------------------------------------------------------------------- |
| M0     | 仓库启动、命名、CI 中的兼容性门禁、贡献者文档                        |
| M1     | 名义类型：`newtype`、`data`；带穷尽性检查的 `match`                  |
| M2     | 高阶类型：kind 系统、类型应用、推断                                  |
| M3     | 固有 `impl`；带孤儿规则的 trait；trait 方法的点调用（Tier C 的 RFC） |
| M4     | GADT                                                                 |
| M5     | 一等（编译期）类型                                                   |

**Stage 2：整顿，放在 edition 开关之后。** Stage 1 稳定后，用一个独立的、需主动开启的 edition（绝不搞一刀切）开始摒弃历史包袱：遗留的 `var`、`with`、`arguments`，`enum` 与 `namespace` 的怪异之处，宽松相等，隐式 `any`，`null`/`undefined` 的二分，以及旧式的类型层语法（由新的原语取代）。老项目照现在的方式继续编译。

---

## 开放问题

我们宁可列出来，也不藏起来：

- **面向纯 TypeScript 使用者的声明输出。** 名义类型无法在普通 `.d.ts` 中无损表达；用"品牌式结构类型"做回退是一种选择。
- **跨重复包的名义身份。** `node_modules` 里同一个包的两份副本，不能变成"同名但不兼容的类型"。
- **工具链。** 任何在 emit 时依赖类型信息的东西，对逐文件转译器都很难处理。Tier C 正是这里的痛点。
- **变型标注。** 既然不用 `F<out _>` 这种占位符写法，抽象类型构造器的变型要另想办法。
- **实例的可见性与一致性。** 孤儿规则之外的细节。

---

## 常见问题

**为什么 fork TypeScript 6.0，而不是原生（Go）移植版？**
6.0 是基于 JavaScript 的编译器的最后一个版本，这份代码库我们可以直接用 TypeScript 本身来修改。代价是真实的：上游正在转向原生实现，所以我们无法白嫖它的修复。为了不堵死这条路，语言语义会通过文档和测试来规定，而不只是靠这份实现。

**为什么用 `_tag` 对象而不是类？**
纯数据能够通过 JSON、`structuredClone` 和消息传递，能与已有的可辨识联合互操作，也让运行时模型保持简单。

**既然 `data` 可以包装一个值，为什么还要 `newtype`？**
单变体的 `data` 是装箱的 `{ _tag, value }`；`newtype` 则被擦除，运行时零开销。代价是它在运行时无法与其底层值区分。

**这只是语法糖吗？**
其中一部分是，我们也明说了（Tier B 的特性）。我们存在的理由是 Tier A 的特性，那些是 TypeScript 今天表达不了的。

---

## 与其他项目的关系

- **TypeScript**：我们是 6.0 版本线的 fork，与微软无隶属关系，也未获其背书。
- **TS+（Effect）**：Effect 团队早先做的一个与我们无关的实验性 TypeScript fork，以 `@tsplus/*` 发布，后来被他们放弃，并写了一篇[复盘](https://effect.website/blog/ts-plus-postmortem)。它的主要教训（依赖类型信息的 emit 加上替换 `tsc`，会与现代逐文件构建工具冲突；改变 `.ts` 文件的含义是个糟糕的主意）塑造了上面的原则。两个项目的名字相似，但 npm 包名不同；我们的编译器命令是 `tspp` 而不是 `tsc`，因此两套编译器可以安装在同一个项目中。
- **灵感来源**：Haskell 和 Scala（类型类、HKT），Rust（孤儿规则、固有 `impl`），Zig（`comptime`），Gleam 和 Koka（`use` / `with`），OCaml 和 F#（ADT、模式匹配）。

---

## 参与贡献

项目还很年轻，所以现阶段最有价值的贡献在于**设计与验证**，而不是代码量：

- 评审并挑战上面的草案。设计讨论以 RFC 的形式放在 `rfcs/` 中（模板稍后提供），每个 `[草案]` 和 `[探索中]` 的条目都会有一份。
- 建立测试程序语料库：今天 TypeScript 表达不了的东西，以及必须保持原有含义的 TypeScript 6.0 程序。
- 参与 M0 与 M1 的编译器工作：新上下文关键字的 parser 支持、名义类型的 binder 与 checker 规则、`match` 的决策树降级。

构建方式沿用上游 TypeScript 6.0（`npm ci`，然后运行 `Herebyfile.mjs` 中的 `hereby` 任务）；ts-plus-plus 专属的指南会随 M0 一起提供。安装包后，使用 `npx tspp` 调用编译器。`CONTRIBUTING.md` 出现后请参阅之。

---

## 许可证

Apache License 2.0。ts-plus-plus 派生自微软的 TypeScript；原有的许可证、版权声明和 `NOTICE` 均予以保留，被修改的文件会标明已修改。"TypeScript" 是 Microsoft Corporation 的商标。

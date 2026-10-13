# 02 — 不需要 MLTT 基础的依赖类型入门

这个示例从普通 TypeScript 使用者熟悉的“值有类型”出发，逐步解释 TS++ 中的类型宇宙、依赖函数、类型族，以及它们与原生 TypeScript 类型的关系。

## 学习路线

示例拆分在 `src` 目录中，建议按顺序阅读：

1. [`01-basics.tspp`](./src/01-basics.tspp)：从值与类型开始，逐步学习 universe、Pi、类型族和 TS 函数桥接；
2. [`02-advanced.tspp`](./src/02-advanced.tspp)：依次学习 Nat 索引、类型级计算、消去器、相等证明和 Sigma；
3. [`03-boundaries.tspp`](./src/03-boundaries.tspp)：了解 MLTT/TS 分工、表面语法入口、运行时边界和错误诊断。

三个文件分别对应基础、进阶和边界探索，既可以连续阅读，也可以单独实验。

第一次接触依赖类型时，不建议跳过基础篇。高级篇中的概念有明确依赖关系：

```text
Nat 数据 → NatAdd 计算 → NatElim 递归 → Eq/Refl/J 证明 → Sigma 携带证明
```

遇到陌生术语时，可以先采用下面的直观理解：

| 术语 | 暂时可以理解成 |
| --- | --- |
| binder | 声明一个可供右侧引用的名字 |
| Pi | 返回类型可以依赖参数的函数类型 |
| type family | 输入类型或索引、输出类型的函数 |
| eliminator | 使用某类数据时允许采用的递归原则 |
| proof object | 某个命题类型的值 |
| Sigma | 后一项类型可以依赖前一项的 pair |

## 先建立一个心智模型

在普通 TypeScript 里，我们经常写：

```ts
const count: number = 1;
```

`count` 是值，`number` 是它的类型。依赖类型系统还需要继续问一句：**类型本身属于哪一层？**

TS++ 使用 `Type0`、`Type1`、`Type2`……表示逐级升高的类型宇宙：

```text
普通值  ──属于──> 普通类型
普通类型──属于──> Type0
Type0   ──属于──> Type1
Type1   ──属于──> Type2
```

宇宙分层避免让一个宇宙把自己包含进去。入门时只需记住：普通类型在 `Type0` 中，`Type0` 自身在 `Type1` 中。

```ts
type UniverseZero: Type1 = Type0;
```

这里冒号右侧的 `Type1` 是左侧类型表达式的 **kind**，也就是“类型的类型”。

## 什么是依赖函数

原生语法是：

```ts
(参数名: 参数类型) -> 返回类型
```

两种箭头并存，各自承担不同角色：

| 写法 | 含义 |
| --- | --- |
| `(value: string) => string` | 原有 TypeScript 函数类型 |
| `(A: Type0) -> A` | MLTT 依赖函数类型，右侧可以引用左侧的 `A` |

普通函数的返回类型通常是预先固定的；依赖函数允许返回类型引用前面的参数：

```ts
type PolymorphicIdentity: Type1 =
  (A: Type0) -> (value: A) -> A;
```

可以从左到右把它读成：

1. 调用者先选择一个普通类型，命名为 `A`。
2. 调用者再提供一个类型为 `A` 的值，命名为 `value`。
3. 结果也必须是 `A`。

`value` 的类型和最终结果都取决于第一次选择的 `A`，这就是“依赖”的含义。它对应 MLTT 中的 Pi 类型，但理解和使用这段代码并不要求先掌握这个术语。

如果右侧没有使用参数名，依赖关系就退化成普通情况：

```ts
type TypeFamilyShape: Type1 =
  (A: Type0) -> Type0;
```

这表示一个“输入普通类型、输出普通类型”的形状。

## 类型族与应用

类型族可以理解成类型层面的函数。下面的 `F` 接收某个 `A: Type0`，返回另一个 `Type0`：

```ts
type ApplyTypeFamily: Type1 =
  (F: (A: Type0) -> Type0) ->
  (A: Type0) ->
  F<A>;
```

最后的 `F<A>` 是类型应用：把类型族 `F` 应用到类型 `A`。这个例子同时展示了高阶参数和真正依赖前文参数的结果。

## 名称、作用域与“定义相等”

以下两个类型只改了 binder 的名字：

```ts
(A: Type0) -> (value: A) -> A
(T: Type0) -> (item: T) -> T
```

它们表达同一个结构。checker 不会因为 `A` 和 `T` 拼写不同就认为类型不同；elaborator 会把名称转换成 De Bruijn index，MLTT 内核再通过归一化和定义相等比较它们。

如果暂时不熟悉这些内部术语，可以把它理解为：**变量名用于阅读，绑定关系才决定类型含义。**

## 编译器内部经过哪些步骤

```text
.tspp 原生语法
    ↓ parser
DependentFunctionTypeNode
    ↓ elaboration（解析 binder 和作用域）
MLTT term（De Bruijn 表示）
    ↓ 类型推导、归一化、定义相等
DependentFunctionType compiler Type
    ↓
kind 检查、别名传播、类型打印和关系判断
```

这不是字符串桥接。checker 会创建带有 `TypeFlags.DependentFunction` 的正式 compiler type；普通别名可以继续传播它，诊断和声明文件也会保留原生语法。

## 当前示例覆盖的语言边界

目前的 MLTT 子语言支持本示例所需的：

- `Type0`、`Type1` 等宇宙；
- `(A: Type0) -> ...` 依赖函数；
- 对已绑定名称的引用；
- `F<A>` 形式的类型应用；
- `Lam<(x: A) -> term>` term-level lambda 与 `Ann<term, type>` 显式类型标注；
- 内建 `Nat`、`Zero`、`Succ<N>` 自然数索引，以及可归约的 `NatAdd<A, B>`；
- `NatElim` 依赖消去器与对 `Zero`/`Succ` 的计算规则；
- `Eq<A, x, y>`、`Refl<A, x>` identity type 和反身证明，以及 `J` path induction；
- `Sigma<(x: A) -> B>`、`Pair`、`First`、`Second` 依赖对及投影归约；
- 由原 TypeScript checker 检查的 primitive、union/intersection、普通泛型引用、`keyof`、indexed access、mapped type 和 conditional type；
- alpha/beta 与内建 eliminator 计算规则构成的定义相等，以及 universe/kind 检查；
- 将形如 `(A: Type0) -> (value: A) -> A` 的 Pi 类型与显式注解的
  TypeScript 泛型函数互相赋值，并复用 TypeScript 的调用推断。

嵌入 MLTT 的 TypeScript 类型会保留其真实 kind，并继续采用 TypeScript 的结构类型语义；别名名称不同但结构相同的类型不会因此变成不同的依赖类型。union/intersection 也不能用来把高层 universe 的类型伪装成 `Type0`。

项目使用独立的 `tsppconfig.json` 开启这项实验能力：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "tsppFeatures": [
      "higherKindedTypes",
      "typeUniverses",
      "dependentFunctionTypes",
      "dependentFunctionInterop",
      "naturalNumbers",
      "naturalNumberAddition",
      "naturalNumberElimination",
      "identityTypes",
      "sigmaTypes"
    ]
  }
}
```

每个能力及其依赖都必须显式列出，编译器不会自动补齐。普通 `.ts` 文件永远不会启用依赖语法，即使同一项目开启了这些特性；其中原有的 `=>` 函数类型也不受影响。

闭合的 `Eq`、`Sigma` 等 MLTT 类型现在可以直接写在类型别名右侧，不再需要人为包一层 Pi。

目前没有新增一套运行时函数语法；实现仍写成普通 TypeScript 泛型函数。
`02-advanced.tspp` 演示了它如何赋给 Pi 类型并以依赖函数的类型直接调用。
这个桥接暂时要求函数签名完整注解，不包括可选/剩余参数、默认/约束类型参数等扩展形式。

Pi 仍负责引入依赖 binder；`Eq`、`NatElim`、`J` 和 `Sigma` 等构造也可以在 `.tspp`
的闭合类型位置直接 elaboration。运行时 `Nat` binder 只接受非负安全整数的字面量类型，
因此负数、小数和无法静态确定的 `number` 会在调用点报错。具体示例见高级篇和边界篇。

## 运行与实验

### 在 VS Code 开发窗口中运行

在仓库根目录按 `F5`，然后选择：

- **TS++: Run Example 02 — Dependent Types**：只打开本教程；
- **TS++: Run All Examples**：打开整个 `example` 目录，并排显示两个示例。

开发窗口左下角的 **TS++ Examples** 状态栏按钮也可以随时切换或同时打开示例。

第一次运行时，如果 VS Code 询问是否允许使用工作区版本的 TypeScript，请选择 **Allow**。

### 使用命令行

先在仓库根目录构建 compiler，然后进入本目录运行：

```powershell
npm run check
npm run emit-declarations
```

第二条命令会在 `dist` 中按课程文件生成对应的 `.d.tspp` 声明。依赖函数会保持 `(A: Type0) -> ...`，不会退化成 `unknown`。

阅读完正常示例后，可以取消 [`03-boundaries.tspp`](./src/03-boundaries.tspp) 中任意错误案例的注释，再运行 `npm run check`，观察未绑定变量、错误 universe 和非法组合的诊断。

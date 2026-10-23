# 02 — 依赖类型：从“返回原类型”到“数据携带证明”

这是一套面向 TypeScript 使用者的渐进教程，不要求预先了解 MLTT。每个源码文件只回答一个主要问题；建议按编号阅读，并在编辑器中悬停查看归约后的类型。

## 学习路线

| 章节 | 要回答的问题 | 新概念 |
| --- | --- | --- |
| [`01-basics.tspp`](./src/01-basics.tspp) | 类型本身属于什么？返回类型如何引用参数？ | universe、Pi、binder、类型族 |
| [`02-booleans.tspp`](./src/02-booleans.tspp) | 返回类型如何随布尔值变化？ | motive、`BoolElim`、`If` |
| [`03-type-matching.tspp`](./src/03-type-matching.tspp) | 如何对类型本身做精确分支和解构？ | `match`、`infer`、equal/apart/stuck |
| [`04-naturals.tspp`](./src/04-naturals.tspp) | 如何用自然数表达长度并做递归？ | `Nat`、`NatAdd`、`NatElim` |
| [`05-equality.tspp`](./src/05-equality.tspp) | “算出来相同”和“有相等证明”有何区别？ | 定义相等、`Eq`、`Refl`、`J` |
| [`06-sigma.tspp`](./src/06-sigma.tspp) | 如何把数据与关于它的证明打包？ | `Sigma`、`Pair`、投影 |
| [`07-boundaries.tspp`](./src/07-boundaries.tspp) | 当前实现会明确拒绝什么？ | MLTT/TS 分工、运行时边界 |

前四章建立计算能力，第五章才正式讨论证明，第六章再组合数据与证明。`07` 中的反例适合最后阅读，不应作为语法入门材料。

```text
universe 与 Pi
      ↓
Bool 的依值计算 ──→ 类型的精确匹配
      ↓
Nat 的索引与递归
      ↓
定义相等 vs Eq 证明
      ↓
Sigma：数据 + 依赖证据
```

## 阅读时只需先记住四件事

1. 普通值有普通类型，普通类型位于 `Type0`，`Type0` 位于 `Type1`。
2. TypeScript 函数类型写 `(x: A) => B`；TS++ 的 Pi 类型写 `(x: A) -> B`，后面的 `B` 可以引用 `x`。
3. 类型族就是“输入类型或索引，输出类型”的函数；`F<A>` 是对它的应用。
4. 实现仍是普通 JavaScript/TypeScript 函数。TS++ 新增的是编译期类型与计算规则，不是另一套运行时语言。

如果遇到术语，可以先采用下面的直观解释：

| 术语 | 入门理解 |
| --- | --- |
| binder | 引入一个可供右侧引用的名字 |
| Pi | 返回类型可以依赖参数的函数类型 |
| motive | 描述消去结果怎样随被检查值变化的类型族 |
| eliminator | 一类数据允许采用的递归/分情况规则 |
| proof object | 某个命题类型的值 |
| Sigma | 第二项类型可以依赖第一项的 pair |

## 两种相等不要混淆

| 相等 | 谁来判断 | 是否有证明值 | 例子 |
| --- | --- | --- | --- |
| 定义相等 | checker 归一化后判断 | 否 | `NatAdd<1, 1>` 与 `2` |
| 命题相等 `Eq<A, x, y>` | 写在系统内部的类型 | 是 | `Refl<A, x>` 证明 `x = x` |

alpha 改名、beta 归约以及 `If`、`NatElim`、`J`、Sigma 投影等内建计算规则都参与定义相等。拥有一个 `Eq` 证明不会自动开启相等反射；需要使用相等证明时，由 `J` 表达其消去原则。完整解释在 [`05-equality.tspp`](./src/05-equality.tspp)。

## 类型匹配为什么单独成章

`If` 根据 `Bool` 值分支；`match mltt T { P: R, _: F }` 根据类型的定义相等分支。这种类型反射不是普通参数多态，而是 TS++ 明确提供的受控能力。

- 比较是精确相等，不是单向的 TypeScript `extends`；
- `Case<Array<infer T>, T>` 按构造器身份捕获泛型参数：透明别名可匹配，tuple、`ReadonlyArray`、派生接口和交叉类型不可匹配；
- 开放 binder 信息不足时得到 `stuck`，不会提前选择后备分支；
- union 作为整体比较，不做分布式匹配；
- `match` 按顺序检查分支，并且必须以 `_` 默认分支结束；旧的 `IfType`、`TypeMatch`、`Case`、`Default` 只是共享同一核心的兼容写法。

这些规则和运行时桥接示例集中在 [`03-type-matching.tspp`](./src/03-type-matching.tspp)。

## TypeScript 与 MLTT 如何分工

TS++ 是在 TypeScript 中嵌入一小块 MLTT，而不是替换 TypeScript 类型系统。

- object、union、`keyof`、mapped/conditional type 和结构类型关系仍由 TypeScript checker 处理；
- universe、Pi、Bool/Nat 消去、`Eq`/`J`、Sigma、归约和定义相等由 MLTT 内核处理；
- external bridge 把可表示的 Pi 类型投影为普通 TypeScript 泛型调用签名。涉及 `infer` 时，声明中的 conditional type 受 TypeScript 结构类型语义限制，是核心构造器匹配的近似投影；TS++ checker 内部仍使用精确的构造器身份。

例如 `{A: Type0} -> (value: A) -> A` 可以连接到 `<A>(value: A) => A`。`{A: Type0}` 是擦除的编译期 binder，`(A: Type0)` 则接收 `reify A` 产生的运行时类型 descriptor；`reify Array` 也能表示尚未应用的类型构造器。编译期类型已确定的 descriptor 还能使用 `match mltt descriptor { Array<infer E> => expression, _ => fallback }` 在表达式位置匹配，编译器会实例化捕获类型并只输出选中的分支。隐式与显式 binder 交替出现时，所有 `{}` binder 都会收集到泛型列表，所有 `()` binder 保持为实际参数。调用中的 `f<auto, string>(...)` 表示推断第一个泛型并固定第二个。Bool binder 会投影成布尔泛型参数，Nat binder 只接受非负安全整数字面量。具体示例见 [`01-basics.tspp`](./src/01-basics.tspp)，限制集中在 [`07-boundaries.tspp`](./src/07-boundaries.tspp)。

## 实验特性

本项目通过 [`tsppconfig.json`](./tsppconfig.json) 显式启用教程所需能力。普通 `.ts` 文件不会因为同一项目的配置而获得 `.tspp` 语法。

```json
{
  "compilerOptions": {
    "tsppFeatures": [
      "higherKindedTypes",
      "typeUniverses",
      "dependentFunctionTypes",
      "dependentFunctionInterop",
      "typeMatching",
      "naturalNumbers",
      "naturalNumberAddition",
      "naturalNumberElimination",
      "booleans",
      "booleanElimination",
      "identityTypes",
      "sigmaTypes"
    ]
  }
}
```

能力及其依赖必须显式列出，编译器不会自动补齐。

## 运行与实验

先在仓库根目录构建 compiler，再进入本目录运行：

```powershell
pnpm check
pnpm emit-declarations
```

`check` 也会验证 [`07-boundaries.tspp`](./src/07-boundaries.tspp) 中由 `@ts-expect-error` 保护的反例。`emit-declarations` 会在 `dist` 中按章节生成 `.d.tspp`，依赖函数语法会被保留。

在仓库根目录按 `F5`，选择 **TS++: VS Code Extension**，再通过窗口左下角的 **TS++ Examples** 状态栏按钮选择本例，即可在 Extension Development Host 中阅读悬停结果。若 VS Code 询问是否允许工作区版本的 TypeScript，请选择 **Allow**。

### 用悬浮窗查看规范形

打开 [`src/01-basics.tspp`](./src/01-basics.tspp)，将鼠标悬停在
`HoverToSeeNormalized` 类型名上。它的源码右侧写的是 `TextAlias`，别名展开后的
规范形是 `string`，所以扩展会额外显示：

```text
Normalized: string · Kind: Type0
```

`Normalized` 表示 checker 完成透明别名展开和类型层计算后的结果。若观察的是类型，
末尾的 `Kind` 表示它属于哪个 universe；若观察的是 term，则改为显示它的 `Type`。
后续章节中的 `If`、`NatAdd`、
`NatElim`、`match mltt` 和类型应用都可以用这种方式观察归约结果。

如果想看一个真正包含递归计算的例子，请打开
[`src/04-naturals.tspp`](./src/04-naturals.tspp)，悬停 `HoverComputedNat`。该 term 先用
顶层 term `Two: Nat` 计算 `1 + 1`，再用 `NatAdd<Two, Two>` 计算 `2 + 2`，最后在
悬浮窗中直接显示这个 Nat term 的计算结果。term alias 和 `NatAdd` 都会消失，结果为
`Succ<Succ<Succ<Succ<Zero>>>>`（即 `4`），末尾显示 `Type: Nat`。这可以验证嵌套的
自然数递归确实参与了规范化，而不只是展开一个普通 alias。`ComputedNatIsFour`
另外展示了如何把同一个计算写成 `Eq` 命题；观察计算本身不需要用 `Eq` 包裹。

这个额外提示不是每次悬停都会出现。它只在以下条件同时满足时显示：

1. 文件是项目中的 `.tspp` 文件，Development Extension 能按 `tsppconfig.json` 成功建立程序；
2. 光标位于类型别名名称或可查询的类型表达式上；
3. 忽略排版空白后，源码写法与计算出的规范形不同。

例如，悬停 `AlreadyNormalized` 时不会显示额外提示，因为它的源码和规范形都是
`string`。光标位于普通值表达式上、源码暂时不完整、文件存在阻止分析的语法错误，
或者所需实验特性没有启用时，也不会显示。没有额外的 `Normalized` 提示并不代表
普通类型悬浮失效；语言服务器原有的类型签名和文档仍会照常显示。

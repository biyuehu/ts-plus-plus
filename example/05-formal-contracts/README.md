# 05 — 形式化契约与循环不变式

这个示例按文件分别展示 `formalContracts`、`refinementTypes` 和 `standardLibraryPredicates`：

- [`01-function-contracts.tspp`](./src/01-function-contracts.tspp)：`requires`、`ensures`、隐式返回值 `result` 和多返回路径；
- [`02-loop-invariants.tspp`](./src/02-loop-invariants.tspp)：循环不变式的初始化与保持性证明；
- [`03-number-model.tspp`](./src/03-number-model.tspp)：显式选择数学实数模型后验证 `number`；
- [`04-refinement-types.tspp`](./src/04-refinement-types.tspp)：精化类型的引入、控制流证明和谓词传播；
- [`05-refined-newtype.tspp`](./src/05-refined-newtype.tspp)：在 `newtype` 构造入口应用 `with` 谓词约束。
- [`06-sum-types.tspp`](./src/06-sum-types.tspp)：把 `data` 和封闭判别联合降低为 Z3 和类型，并复用 TypeScript 的控制流窄化。
- [`07-recursive-data.tspp`](./src/07-recursive-data.tspp)：递归 `data`、variant 构造器和由 checker 窄化的 `switch`。
- [`08-standard-predicates.tspp`](./src/08-standard-predicates.tspp)：标准库整数谓词 `isEven`、`isOdd`、`isPositive`、`isNonNegative`、`isZero`、`divides` 与 `between` 的精化类型引入。

`divides(a, b)` 表示 `a` 整除 `b`；`between(value, lower, upper)` 是闭区间判断，即 `lower <= value <= upper`。

## 积类型、和类型与 TypeScript 控制流

验证器直接读取 TypeScript checker 在当前位置已经得到的窄化类型。带唯一字符串 `_tag` 的封闭判别联合和 TS++ `data` 声明会降低为 Verification IR 和类型，再编码为 Z3 datatype；variant 字段只能在 checker 已经确认对应分支后读取。验证层维护的符号状态只记录 SMT 值和证明事实，不重新实现 TypeScript 的结构兼容或控制流窄化。

记录字面量、variant 构造器以及递归代数数据会直接编码成 Z3 datatype 构造项。可选字段、索引签名和开放联合仍会得到明确的 `unknown`，不会通过删除无法编码的部分来伪装成证明成功。`switch (value._tag)` 的分支事实来自 checker 在对应 case 中已经完成的窄化。

## 函数契约

契约写在参数列表之后、返回类型之前：

```ts
function successor(value: bigint) with {
  requires: value >= 0n;
  ensures: result > value;
}: bigint {
  return value + 1n;
}
```

`requires` 是证明函数实现时采用的前提；`ensures` 必须在每一条显式返回路径上成立。
`ensures` 中的 `result` 表示当前路径实际返回的值。能够静态解析到项目函数声明的直接调用也会验证
`requires`，例如 `successor(-5n)` 会在调用位置报告反例 `value = -5`。验证函数内部的调用时，
调用者的 `requires` 和当前符号路径事实也会参与证明。

动态调用、复杂参数绑定和无法解析的调用不在当前直接调用子集内；相关值进入证明时会明确得到
`unknown`，不会被当作验证成功。

## 循环不变式

循环不变式写在条件之后、循环体之前：

```ts
while (current < limit) with {
  invariant: current >= 0n;
  invariant: current <= limit;
} {
  current += 1n;
}
```

编译器分别生成两类证明义务：

1. **初始化**：第一次进入循环前不变式已经成立；
2. **保持性**：假设不变式和循环条件成立，执行一次循环体后不变式仍然成立。

循环结束后的代码可以继续使用不变式与循环退出条件。所有契约和不变式都会从最终
JavaScript 中擦除。

## `number` 模型

JavaScript `number` 具有 IEEE-754 舍入、`NaN` 和无穷等行为，不能默认等同于数学实数。
因此必须显式选择抽象模型：

```ts
function scaledSum(left: number, right: number) with {
  numberModel: "mathematical-real";
  ensures: result === (left + right) * 0.5;
}: number {
  return (left + right) * 0.5;
}
```

这项证明只说明数学实数模型下的结论，不代表对所有 IEEE-754 边界值都成立。没有这个属性
时，涉及 `number` 的证明会得到 `unknown`。

## 精化类型与传播

精化直接写在普通结构类型别名上，不依赖 `newtype`：

```ts
type Positive = bigint with { predicate: value > 0n; };
type NonNegative = bigint with { predicate: value >= 0n; };

const age: Positive = 18n;

function widen(value: Positive): NonNegative {
  return value;
}
```

`value` 表示正在引入精化类型的值。函数参数的精化谓词会作为函数体内的已知事实，因此 Z3 可以证明 `value > 0n` 蕴含 `value >= 0n`。精化类型在 JavaScript 中完全擦除，不生成构造器。

## 带约束的 `newtype`

`with` 谓词也可以附加到 `newtype`。此时每次显式调用构造器都会生成证明义务：

```ts
newtype Port = bigint with {
  predicate: value > 0n && value <= 65535n;
};

const http = Port(80n); // proved
```

它与结构精化类型的区别是：`newtype` 仍保持名义边界并生成原有的轻量构造器；谓词本身仍只在编译期存在，不进入 JavaScript。

## 查看 SMT-LIB

在仓库的 Extension Development Host 中打开这些文件，然后运行：

```text
TS++: Show Verification SMT-LIB
```

命令会列出当前文件的全部证明义务，并在侧栏打开所选义务的状态、说明和可独立重放的
SMT-LIB。编译器 API 也可以通过 `program.getVerificationArtifacts()` 读取相同产物，包括
Z3 反例模型。

证明结果分为 `proved`、`failed`、`unknown` 和 `error`。不支持的表达式、控制流或运行环境
会得到带原因的 `unknown` 编译错误。

## 运行示例

先在仓库根目录构建编译器：

```powershell
npm run build:compiler
```

然后运行：

```powershell
cd example/05-formal-contracts
npm run check
npm run build
npm start
```

预期输出：

```text
absolute(-5) = 5
successor(5) = 6
countTo(4) = 4
scaledSum(2, 6) = 4
even = 42
odd = 43
positive = 42
non-negative = 0
zero = 0
divisible by three = 42
teen = 17
```

可以在 `dist` 中确认生成的 JavaScript 不包含 `with`、`requires`、`ensures` 或 `invariant`。

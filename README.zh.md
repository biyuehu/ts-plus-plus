# ts-plus-plus

[English](README.md) | **简体中文**

> [#](https://github.com/biyuehu/ts-plus-plus/issues/2) 中的设计提案仅用于演示，并非计划，也不是 TODO，更不构成承诺。可以把它看作一种可能方向的预览，而非路线图。

ts-plus-plus 是一门派生自 TypeScript 的实验性语言。所有扩展都需要在 `tsppconfig.json` 中逐项手工开启。

没有 `tsppconfig.json` 时，全部 TS++ 特性关闭，编译器行为与 TypeScript 一致；`.tspp` 和 `.d.tspp` 文件也不会参与项目发现或模块解析。

## 贡献者

<!-- markdownlint-disable -->

<a href="https://github.com/biyuehu/ts-plus-plus/graphs/contributors">
  <img src="assets/contributors.svg" alt="Contributors" />
</a>

<!-- markdownlint-enable -->

## 初始化项目

```sh
tspp --init
```

如果当前目录没有 `tsconfig.json`，命令会先生成一份；随后生成以 `"extends": "./tsconfig.json"` 继承它的 `tsppconfig.json`，且不会修改已有的 TypeScript 配置。生成文件的注释头会记录编译器提交哈希，并动态列出当前版本的全部特性，默认全部关闭。

特性需要手工开启：

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "tsppFeatures": [
      "higherKindedTypes",
      "newtypeDeclarations",
      "dataDeclarations",
      "formalContracts",
      "refinementTypes",
      "typeUniverses"
    ]
  }
}
```

依赖项也必须显式列出。未知特性、重复特性或缺少依赖都会成为配置错误：编译器拒绝启动编译，不修改配置，也不会容错降级运行。

## 特性可能带来的影响

每项特性只按两个彼此独立的维度评估：

- **是否保持 TypeScript 超集**：已有 TypeScript 的语法、类型检查和运行时行为保持兼容。
- **是否保持透明擦除**：只需删除类型语法，不生成或改变 JavaScript 运行时代码。

只有全部已开启特性都保持第一项时，当前配置下的语言才保持 TypeScript 超集；只有全部已开启特性都保持第二项时，才保持透明擦除。我们不再把声明文件保持情况单独作为一个维度记录。

当前特性如下：

| 特性 | 获得 | 必须显式开启的依赖 | TS 超集 | 透明擦除 |
| --- | --- | --- | --- | --- |
| `higherKindedTypes` | 高阶类型参数和一等类型构造器 | 无 | 是 | 是 |
| `newtypeDeclarations` | `newtype` 名义类型声明与对应构造器 | 无 | 是 | 否（生成运行时构造器） |
| `dataDeclarations` | `data` 可辨识联合声明与对应变体构造器 | 无 | 是 | 否（生成运行时变体值与构造器） |
| `formalContracts` | 由 Z3 验证的 `requires`、`ensures` 和 `while` 循环不变式 | 无 | 是 | 是 |
| `standardLibraryPredicates` | 标准库数值谓词 `isEven`、`isOdd`、`isPositive`、`isNonNegative`、`isZero`、`divides`、`between`；`number` 需设置 `numberModel: "mathematical-real"` | `formalContracts` | 是 | 是 |
| `refinementTypes` | 由 Z3 验证结构类型别名引入点的谓词 | `formalContracts` | 是 | 是 |
| `typeComputation` | 类型层局部绑定 `let X = T in U` 与匿名类型层 lambda `<T> => Body` | 无 | 是 | 是 |
| `typeUniverses` | `Type0`、`Type1` 等类型宇宙与 kind 分层 | `higherKindedTypes` | 是 | 是 |
| `dependentFunctionTypes` | Pi 类型，以及显式的 `Lam`/`Ann` MLTT 项 | `typeUniverses` | 是 | 是 |
| `dependentFunctionInterop` | Pi 类型与 TypeScript 泛型函数之间的赋值和调用 | `dependentFunctionTypes` | 是 | 是 |
| `typeMatching` | 精确 `IfType`、有序 `TypeMatch`，以及按构造器身份解构泛型类型的分支局部 `infer` 捕获 | `dependentFunctionTypes` | 是 | 是 |
| `naturalNumbers` | `Nat`、`Zero`、`Succ` 类型级自然数 | `dependentFunctionTypes` | 是 | 是 |
| `naturalNumberAddition` | 可归约的 `NatAdd` 类型级加法 | `naturalNumbers` | 是 | 是 |
| `naturalNumberElimination` | `NatElim` 依赖消去器 | `naturalNumbers` | 是 | 是 |
| `booleans` | `Bool`、`True`、`False` 类型级布尔值 | `dependentFunctionTypes` | 是 | 是 |
| `booleanElimination` | `BoolElim` 依赖消去器与 `If` 依值分支 | `booleans` | 是 | 是 |
| `identityTypes` | `Eq`、`Refl`，以及 `J` 路径归纳 | `dependentFunctionTypes` | 是 | 是 |
| `sigmaTypes` | `Sigma`、`Pair`、`First`、`Second` 依赖对及投影 | `dependentFunctionTypes` | 是 | 是 |

自动生成的配置是与编译器版本对应的权威特性说明。本项目仍处于实验阶段；表中的结论描述当前实现，不是对未来新增特性的永久承诺。

## 验证架构

契约、控制流事实和精化谓词都会降低到与求解器无关的 Verification IR。只有 SMT 后端负责把这份 IR 序列化为 SMT-LIB 并调用 Z3；TypeScript 自身的控制流分析仍作为事实来源被复用，而不是被替换。宏与验证共享有界分析 worker 队列，能够传播取消和超时结果，并在增量 Program 之间复用按完整义务内容寻址的成功结果。

MLTT Core 继续保留自己的项、归约和定义相等性。将来若加入 MLTT 精化，应只通过适配器把其中可判定的算术/相等片段降低到 Verification IR，而不把 MLTT Core 与 SMT 表示合并。

## 形式化契约

开启 `formalContracts` 后，可以给函数附加契约，并给 `while` 附加循环不变式：

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

当前子集支持 `boolean`、`bigint`、`string`、局部变量、赋值、分支、`switch`、多返回路径、带不变式的循环，以及对能够静态解析到项目函数声明的直接调用检查 `requires`。记录与记录字面量、带唯一字符串 `_tag` 的封闭判别联合、TS++ `data` 构造器和递归代数数据会通过 TypeScript checker 已经计算出的类型与控制流窄化降低为 Verification IR 的积类型/和类型，再编码为 Z3 datatype；验证器不会并行实现另一套 TypeScript 类型窄化。可选字段、索引签名和开放联合目前会明确得到 `unknown`。验证函数内部调用时，调用者前提与当前符号路径事实也会参与证明。只有在函数契约中加入 `numberModel: "mathematical-real";` 后才支持 `number`；它明确表示把 `number` 抽象成数学实数，而不是 JavaScript 的 IEEE-754 数值。

每个证明义务都会得到 `proved`、`failed`、`unknown` 或 `error` 状态，任务结果还会区分取消与超时。不支持的语法以及求解器不可用都会产生 `unknown` 编译错误，绝不会伪装成证明成功。`Program.getVerificationArtifacts()` 会公开实际求解器输入、可重放的 SMT-LIB、状态、解码后的源码级反例、原始模型和源码位置。开发扩展中的 **TS++: Show Verification SMT-LIB** 命令可以在源码旁直接打开这份输入。

## 类型层 lambda

开启 `typeComputation` 后，可以用 `<T> => Body` 语法编写匿名类型层函数：

```typescript
// 匿名恒等函子：接受一个类型并原样返回。
type Id = <T> => T;
type IdNumber = Id<number>; // number

// 双参数 lambda：交换二元组的两个分量。
type Swap = <A, B> => [B, A];
type Swapped = Swap<string, number>; // [number, string]
```

类型 lambda 与高阶类型参数互通。`<T> => Body` 的 kind 为 `Type => Type`，可以传递给任何接受类型构造器的位置：

```typescript
// 需要同时开启 typeComputation + higherKindedTypes。
type Apply<F: Type => Type, X> = F<X>;

type Doubled = Apply<<T> => [T, T], boolean>; // [boolean, boolean]
```

lambda 体可以引用任何在作用域内的类型。类型参数和 lambda 语法本身会像其他所有 TS++ 类型语法一样被擦除，不产生任何 JavaScript 输出。

## 协议

Apache 许可证 2.0。tsplusplus 派生自 Microsoft 的 TypeScript；原始许可证、版权声明和 NOTICE 保持不变，修改过的文件将被标记为已修改。“TypeScript”是 Microsoft Corporation 的商标。

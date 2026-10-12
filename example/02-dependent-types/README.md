# 02 — 不需要 MLTT 基础的依赖类型入门

这个示例从普通 TypeScript 使用者熟悉的“值有类型”出发，逐步解释 TS++ 中的类型宇宙、依赖函数和类型族。建议先按顺序阅读 [`index.tspp`](./index.tspp)，再回来查看本页的整体说明。

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
- 由原 TypeScript checker 检查的 primitive、union/intersection、普通泛型引用、`keyof`、indexed access、mapped type 和 conditional type；
- alpha/beta 定义相等和 universe/kind 检查。

项目使用独立的 `tsppconfig.json` 开启这项实验能力：

```json
{
  "compilerOptions": {
    "dependentTypes": true
  }
}
```

两个条件缺一不可：文件必须是 `.tspp`/`.d.tspp`，并且 `tsppconfig.json` 必须显式开启 `dependentTypes`。普通 `.ts` 文件永远不会启用依赖语法，即使同一项目打开了该选项；其中原有的 `=>` 函数类型也不受影响。

另外，这里的代码是在**描述类型**，还没有提供对应的运行时函数实现语法。

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

第二条命令会在 `dist/index.d.tspp` 中生成声明。依赖函数会保持 `(A: Type0) -> ...`，不会退化成 `unknown`。

阅读完正常示例后，可以取消 `index.tspp` 最后几条错误案例中的任意一条注释，再运行 `npm run check`，观察未绑定变量和错误 universe 的诊断。

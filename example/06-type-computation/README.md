# 06 — 类型层计算与类型 Lambda

这个项目演示 TS++ 的 `typeComputation` 特性，聚焦于 **类型层 lambda**（`<T> => Body` 语法）。

## 开启的特性

- `typeComputation` — 核心：`let X = T in U` 绑定与类型层 lambda；
- `higherKindedTypes` — 高阶类型参数；
- `typeUniverses` — `Type0`、`Type1` 等宇宙，`higherKindedTypes` 的依赖项。

## 源码概览

### `src/01-type-lambdas.tspp`

按顺序展示六个主题：

1. **基础** — 恒等、投影与交换 lambda；
2. **柯里化** — 嵌套 lambda 逐步捕获参数；
3. **高阶集成** — `Apply<F, X>` 把任意 `Type => Type` 的 lambda 当构造器传递；
4. **组合子** — `Compose<F, G>` 在类型层组合两个函子；
5. **具名别名** — 把 lambda 绑定到 `type` 别名后复用；
6. **反例** — `@ts-expect-error` 保护的错误用法，确保编译器正确拒绝。

## 核心语法

### 匿名类型 lambda

```typescript
type Id   = <T> => T;           // kind: Type => Type
type Swap = <A, B> => [B, A];   // kind: (Type, Type) => Type
```

类型 lambda 可以直接用尖括号应用：

```typescript
type IdNum  = Id<number>;          // number
type Swapped = Swap<string, number>; // [number, string]
```

### 与高阶类型参数结合

```typescript
type Apply<F: Type => Type, X> = F<X>;

type R = Apply<<T> => T[], boolean>; // boolean[]
```

### 嵌套（柯里化）

```typescript
type CurriedPair = <A> => (<B> => [A, B]);

type Step1 = CurriedPair<string>; // <B> => [string, B]
type Step2 = Step1<number>;       // [string, number]
```

## 擦除行为

类型 lambda 完全位于类型层。编译产物（`.js` 或 `.d.ts`）中不会出现任何与 lambda 相关的运行时代码；擦除后与等价的普通 TypeScript 泛型别名完全相同。

## 在插件开发窗口中运行

在仓库根目录按 `F5`，选择 **TS++: Open Type Computation Example**。

## 命令行验证

在本目录运行：

```powershell
npm run check
npm run emit-declarations
```

声明输出位于 `dist/`。


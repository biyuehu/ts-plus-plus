# 06 — 类型层计算（Type Computation: let-in / match / lambda）

这个项目系统演示 TS++ 的 `typeComputation` 特性三部曲：
1. **`let ... in` 局部类型绑定**：在类型表达式中引入中间计算，避免重复与深层嵌套；
2. **`match` 类型级模式匹配**：结构化 `infer` 解构、代数数据类型（ADT）类型构造器匹配、原生基元与字面量直接匹配；
3. **`=>>` 类型 Lambda**：一等公民匿名类型函数，支持柯里化、高阶类型组合子；
4. **综合计算**：三大支柱结合的类型层算法管线。

## 开启的特性

- `typeComputation` — 核心：`let X = T in U` 局部绑定、`match` 模式匹配与 `=>>` 类型 lambda；
- `higherKindedTypes` — 高阶类型参数支持；
- `typeUniverses` — `Type0`、`Type1` 等类型宇宙；
- `dataDeclarations` — 代数数据类型（ADT）支持。

## 源码概览

### 1. `src/01-let-bindings.tspp`
- **局部缓存**：避免昂贵或复杂的复合类型重复书写；
- **连续与嵌套绑定**：步进式管线化类型推导；
- **词法作用域与遮蔽（Shadowing）**：内层绑定安全遮蔽外层绑定；
- **作用域隔离**：绑定的类型名称严格限制在 `in` 之后，外部无法访问；
- **泛型约束验证**：正确检测未定义类型与类型错误。

### 2. `src/02-type-match.tspp`
- **语法**：`match Scrutinee { Pattern: Result, ... }`，使用冒号 `:` 分隔模式与结果，逗号 `,` 或分号 `;` 分隔分支；
- **结构化解构**：元组 `[infer Head, ...infer Tail]`、嵌套对象 `{ data: infer D, status: 200 }`、数组 `Array<infer U>` 等任意复杂结构的 `infer` 解构；
- **ADT 类型构造器匹配**：支持代数数据类型的类型构造器，如 `Maybe<infer U>`、`Either<infer L, infer R>`、`Tree<infer V>`；
- **原生基元匹配**：无类型参数的 `string`、`number`、`boolean` 直接匹配；
- **TypeScript 字面量匹配**：`1`、`false`、`"ping"` 等字面量类型的精确匹配；
- **通配符保底**：`_` 匹配任意剩余类型。

### 3. `src/03-type-lambdas.tspp`
- **语法**：`<T, ...> =>> Body`，使用 `=>>` 避免与普通函数签名 `=>` 混淆；
- **一等公民构造器**：直接使用尖括号应用 `Id<number>`、`Swap<string, number>`；
- **柯里化（Currying）**：嵌套类型 lambda `<A> =>> <B> =>> [A, B]` 分步传参；
- **高阶类型参数**：与 `higherKindedTypes` 配合，将 lambda 作为类型构造器传给 `Apply<F: Type => Type, X>`；
- **组合子**：`Compose<F: Type => Type, G: Type => Type> = <X> =>> F<G<X>>`；
- **类型参数约束**：`<T extends string> =>> { tag: T }` 约束检查。

### 4. `src/04-combined-computation.tspp`
- **综合管线**：定义通用递归变换器 `Transform<Container, F: Type => Type>`；
- **三大特性协同**：`match` 负责解构模式，`let ... in` 负责保存变换后的中间状态，`=>>` lambda 负责提供策略函数。

## 核心语法速览

### `let ... in`
```typescript
type UserResponse<T> = let Payload = { data: T; timestamp: number } in {
    response: Payload;
    backup: Payload;
};
```

### `match`
```typescript
type Unwrap<T> = match T {
    Maybe<infer U>: U,
    [infer A, infer B]: [B, A],
    1: "one",
    string: "is-string",
    _: "other"
};
```

### `=>>` 类型 Lambda
```typescript
type Id   = <T> =>> T;
type Swap = <A, B> =>> [B, A];

type Apply<F: Type => Type, X> = F<X>;
type Boxed = Apply<<T> =>> T[], number>; // number[]
```

## 在插件开发窗口中运行

在仓库根目录按 `F5`，打开命令面板选择 **TS++: Open Type Computation Example**。

## 命令行验证

在本目录运行：

```powershell
pnpm check
pnpm emit-declarations
```

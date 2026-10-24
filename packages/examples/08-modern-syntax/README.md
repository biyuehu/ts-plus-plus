# 08 — 现代值层语法 (Modern Syntax)

这个示例演示 TS++ 的 `modernSyntax` 语法特性，重点增强值层表达式与函数的表达力。

## 学习路线

建议阅读 [`index.tspp`](./index.tspp)：

1. **值层 `let ... in ...` 局部绑定表达式**：声明局部计算变量，避免污染外部作用域；
2. **`do { ... }` 语句块表达式**：将多条语句与分支逻辑封装为求值表达式；
3. **`do` 函数与方法隐式返回**：在函数体前显式标注 `do` 开启尾表达式隐式返回；
4. **与既有普通函数的 100% 隔离**：未标注 `do` 的函数保持标准 TS/JS 行为，绝不自动隐式返回；
5. **`use pattern <- expr` 尾随回调解糖**：在 `do` 块与 `do` 函数中消除嵌套回调金字塔；
6. **`def` 深度不可变常量声明**：加强版 `const`，深度递归只读，零运行时开销。

## 语法概览

### 1. let ... in ... 局部绑定表达式

```tspp
const result = let x = 10, y = 20 in x + y;
// 降级为自执行函数: (() => { let x = 10, y = 20; return x + y; })()
```

### 2. do { ... } 语句块表达式

```tspp
const formatted = do {
  const first = "Alan";
  const last = "Turing";
  `${first} ${last}`;
};
```

支持条件分支尾部隐式返回：

```tspp
const port = do {
  if (isDev) {
    3000;
  } else {
    80;
  }
};
```

### 3. do 函数与方法

通过在函数/方法体前显式添加 `do` 关键字开启隐式返回：

```tspp
function add(a: number, b: number): number do {
  a + b;
}

class Counter {
  private count = 0;
  public increment(): number do {
    this.count + 1;
  }
}
```

默认不带 `do` 的普通函数 `{}` 保持标准语义，避免意外影响既有代码行为：

```tspp
function standard(): void {
  1 + 2; // 不会隐式返回
}
```

### 4. use pattern <- expr 尾随闭包糖 (Trailing Closure Desugaring)

受 Koka / Idris 等现代函数式语言启发，专用于在 `do` 块与 `do` 函数/方法中消除嵌套回调（Callback Hell）。

语句：
```tspp
use r <- withResource();
r.process();
```

在编译时自动脱糖为高阶函数尾随回调传参：
```tspp
withResource(r => {
  return r.process();
});
```

支持多重链式嵌套与解构模式：
```tspp
function handleRequest(): string do {
  use [userId, role] <- withSession();
  use db <- withDatabase();
  db.query(userId, role);
}
```


### 5. def 深度不可变常量声明 (Deep Readonly)

解决标准 JS/TS 中 `const` 仅浅层只读、内部嵌套属性与数组依然可变痛点的原生声明方案：

```tspp
def config = {
  host: "127.0.0.1",
  server: { port: 8080 },
  items: [1, 2],
};

// 编译期拦截一切深层修改：
// config.server.port = 3000; // ❌ 报错：read-only property
// config.items.push(3);      // ❌ 报错：push 不存在于 readonly 数组

// 编译产物零运行时开销（直接输出为 const）：
// const config = { host: "127.0.0.1", server: { port: 8080 }, items: [1, 2] };
```

## 运行与编译

```bash
# 类型检查
pnpm check

# 生成降级 JavaScript
pnpm build
```


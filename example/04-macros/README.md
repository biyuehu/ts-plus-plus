# 04 — 编译期宏入门

宏是在编译期间执行的函数。它拿到的不是运行时数据，而是编译器已经解析好的声明，
因此可以完成两类工作：

1. **检查 AST**：读取目标代码，不符合规则时产生编译错误；
2. **替换 AST**：返回新的 TypeScript 语句，替换调用宏的位置。

本示例就按这两项能力拆成两个互相独立的文件：

- [`01-check.tspp`](./src/01-check.tspp)：检查函数中是否包含 `return`；
- [`02-transform.tspp`](./src/02-transform.tspp)：根据接口名称生成一个常量。

每个文件都把目标声明、宏实现和宏调用放在一起，可以从上到下直接阅读。实际项目中，
宏当然也可以导出到其他文件，再像普通函数一样 `import` 后使用。

## 先看最小用法

宏包含“定义”和“调用”两个部分：

```ts
export macro function check(
  targets: readonly ts.MacroTarget[],
  context: ts.MacroContext,
): ts.MacroReturn {
  // 在编译期检查 targets，或者返回新的 AST
}

macro check(SomeDeclaration);
```

`macro function` 定义宏实现；`macro check(...);` 明确要求编译器执行它。只定义或导入宏
不会触发执行。

宏调用目前是一条独立语句。参数是能解析到声明的名称，例如函数、接口或类，而不是
运行时传给普通函数的值。

## 能力一：检查 AST

[`01-check.tspp`](./src/01-check.tspp) 定义了 `requireReturnStatement`，用来要求目标函数
必须直接包含一条 `return` 语句：

```ts
export function readAnswer(): number {
  return 42;
}

macro requireReturnStatement(readAnswer);
```

宏首先确认调用者只传了一个目标，而且目标确实是函数声明：

```ts
if (targets.length !== 1) {
  return context.fail(`expected 1 target, received ${targets.length}`);
}

const target = targets[0];
if (!ts.isFunctionDeclaration(target.node)) {
  return context.fail(`${target.name} must be a function declaration`);
}
```

然后直接读取函数声明的 AST：

```ts
const hasReturn = target.node.body?.statements.some(ts.isReturnStatement) ?? false;
```

- 检查成功时返回 `undefined`，表示不插入任何代码；
- 检查失败时返回 `context.fail(message)`，错误会出现在宏调用位置。

成功的宏调用只在编译期有意义，不会进入最终 JavaScript。文件末尾提供了一个注释掉的
失败案例，取消注释后运行 `npm run check` 即可观察诊断。

## 能力二：替换 AST

[`02-transform.tspp`](./src/02-transform.tspp) 中的 `exposeTypeName` 接收一个声明：

```ts
macro exposeTypeName(User);
```

它通过 `context.factory` 创建一条 `VariableStatement`。以上调用在概念上会被替换为：

```ts
export const UserTypeName: "User" = "User";
```

这里返回的是 TypeScript AST，不是拼接出来的源码字符串。创建过程从内到外对应源码的
结构：

```text
字符串字面量 "User"
        ↓
变量声明 UserTypeName: "User" = "User"
        ↓
const 声明列表
        ↓
带 export 的变量语句
```

生成的语句会继续参与同一次编译，所以后面的代码能立即使用它：

```ts
const checkedName: "User" = UserTypeName;
```

它也会正常进入 JavaScript 和 `.d.tspp` 输出，而原来的 `macro exposeTypeName(User);`
不会保留到运行时。

## 在 IDE 中查看展开结果

使用仓库自带的 VS Code development extension 打开 `.tspp` 文件后，可以直接检查
每一条宏调用：

- 将鼠标悬浮在 `macro exposeTypeName(User);` 上，会显示这一条调用格式化后的
  TypeScript 展开结果；
- 点击编辑器右上角的预览按钮，会在旁侧打开只读的 `*.expanded.tspp`，展示当前文件
  完成全部宏替换后的最终源码；
- 对只进行检查、不返回 AST 的宏，悬浮窗会说明它不生成语句；在最终源码预览中，
  这类调用会被擦除。

悬浮窗和只读预览都不会修改源文件。修改编译器或 development extension 后，需要
重新执行 `npm run build:compiler` 并重载 Extension Development Host。

## 两个参数分别是什么

### `targets`

`targets` 对应宏调用括号中的声明。每个 `MacroTarget` 常用的属性有：

| 属性 | 含义 |
| --- | --- |
| `name` | 调用处使用的目标名称 |
| `node` | 目标的主要声明节点 |
| `symbol` | checker 中对应的符号 |
| `declarations` | 同一符号关联的全部声明 |
| `sourceFile` | 声明所在的源码文件 |

检查宏通常读取 `node` 或配合 checker 分析类型；生成宏经常使用 `name` 决定新声明的
名称。

### `context`

本示例使用了两个最重要的入口：

| 入口 | 用途 |
| --- | --- |
| `context.fail(message)` | 在宏调用处产生编译错误 |
| `context.factory` | 创建正式的 TypeScript AST 节点 |

需要类型信息时还可以使用 `context.checker`。`context` 也提供当前 `program`、
`sourceFile` 和 `macroInvocation`。

## 宏可以返回什么

| 返回值 | 结果 |
| --- | --- |
| `undefined` | 调用被擦除，不插入代码 |
| `Statement` | 用一条语句替换调用 |
| `Statement[]` | 用多条语句替换调用 |
| `MacroFailure` | 报告编译错误，不生成代码 |

## 运行示例

先在仓库根目录构建 compiler：

```powershell
npm run build:compiler
```

然后进入本目录：

```powershell
cd example/04-macros
npm run check
npm run build
npm start
```

`npm start` 的预期输出为：

```text
User
```

构建后可以对照查看：

- `dist/01-check.js`：保留普通函数，但没有宏调用；
- `dist/02-transform.js`：包含生成的 `UserTypeName`；
- `dist/02-transform.d.tspp`：包含生成的公开声明。

## 当前边界

- 宏调用必须是独立语句：`macro fn(Target1, Target2);`；
- 目标必须是可解析为声明的标识符或属性访问；
- 宏同步执行，不支持返回 `Promise`；
- 当前只展开一轮，生成的 AST 不会再次作为宏调用执行；
- 宏运行在编译器进程中，应只使用可信实现，并保持构建结果可重复。

# 01 — 高阶类型与类型宇宙

这个项目是一份可直接运行的 TS++ 入门示例，按顺序演示：

1. `Type` 与 `Type0`；
2. 普通泛型别名的 kind；
3. 把类型构造器保存为一等类型值；
4. 用高阶类型参数定义 `Functor`；
5. `Type0 : Type1`、`Type1 : Type2`；
6. 非累积宇宙带来的类型检查。

示例的默认状态没有类型错误。源码末尾保留了几行被注释的反例，可以逐行取消注释，观察 TS++ 语言服务的诊断。

## 在插件开发窗口中运行

在仓库根目录按 `F5`，选择 **TS++: Run Example 01 — Higher-Kinded Types**。新打开的 Extension Development Host 会自动打开本项目及 `index.tspp`。

也可以选择 **TS++: Run All Examples**，在同一个开发窗口中浏览 `example` 目录，并排查看示例 01 和示例 02。窗口左下角的 **TS++ Examples** 状态栏按钮可以随时重新选择示例。

第一次运行时，如果 VS Code 询问是否允许使用工作区版本的 TypeScript，请选择 **Allow**。将鼠标悬停在 `labels` 上，可以看到它被推导为 `string[]`。

## 核心语法

普通泛型别名的 kind 可以由声明机械地得到：

```typescript
type Pair<A, B> = [A, B];
// Pair: (Type0, Type0) => Type0
```

如果一个非泛型别名要保存尚未应用的类型构造器，则需要显式标注 kind：

```typescript
type Arrays: Type0 => Type0 = Array;
type StringArray = Arrays<string>;
```

kind 也能约束高阶类型参数：

```typescript
interface Functor<F: Type0 => Type0> {
    map<A, B>(fa: F<A>, fn: (value: A) => B): F<B>;
}
```

`Type` 是 `Type0` 的兼容写法。宇宙层级没有预设上限，编译器会按需识别 `TypeN`；当前采用非累积规则，不会自动把低层宇宙提升到高层宇宙。

```typescript
type UniverseZero: Type1 = Type0;
type UniverseOne: Type2 = Type1;

// kind 中的别名会透明展开为 Type0。
type Arrays: UniverseZero => UniverseZero = Array;
```

## 命令行验证

在本目录运行：

```powershell
npm run check
npm run emit-declarations
```

声明输出位于 `dist/index.d.tspp`。普通 `.ts` 输入仍然输出 `.d.ts`。

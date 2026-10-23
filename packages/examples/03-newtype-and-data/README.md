# 03 — newtype 与 data

这个示例演示 TS++ 的两个名义化声明：`newtype` 和 `data`。两者都通过编译器内部的品牌属性获得名义性，但用途不同。

## 学习路线

建议按顺序阅读 [`index.tspp`](./index.tspp)：

1. `newtype`：给已有类型一个不可互换的新名字；
2. `data`：可辨识联合与变体构造器；
3. `match` 的 guard、or-pattern 与嵌套构造器模式；
4. 名义性、`_tag` 判别式与 `as` 的边界。

## newtype

`newtype` 接受任意类型作为底层，并引入一个同名值构造器，签名是底层类型的恒等函数。

```tspp
newtype UserId = number;
newtype OrderId = number;

declare const userId: UserId;
const asNumber: number = userId;   // 允许：底层是 number
const badNumber: UserId = 1;       // 报错：number 不是 UserId
```

`UserId` 与 `OrderId` 的底层都是 `number`，但它们仍然互不可赋值。

底层可以是对象、联合等任意类型：

```tspp
newtype Point = { x: number; y: number };
newtype StringOrNumber = string | number;
```

## data

`data` 声明一组变体，每个变体可以携带字段。整体形成一个联合类型，变体之间通过 `_tag` 区分。

```tspp
data Option<T> = None | Some(value: T);

const nothing: Option<number> = None;
const something: Option<number> = Some(1);
const bad: Option<number> = Some("x");  // 报错：字段类型不匹配
```

变体只接收它提到的类型参数：`None` 不接受参数，`Some` 只接受 `T`。

```tspp
data Either<L, R> = Left(value: L) | Right(value: R) | Empty;

declare const left: Left<number, string>;
const leftValue: number = left.value;
```

`data` 类型可以递归：

```tspp
data List<T> = Nil | Cons(head: T, tail: List<T>);
const singleItem: List<number> = Cons(1, Nil);
```

值层 `match` 会按构造器绑定字段，并检查所有变体是否都已覆盖：

```tspp
declare const maybe: Option<number>;
const selected = match maybe {
  None => 0,
  Some(value) => value,
};
```

无字段变体可以用 `|` 合并；构造器可以继续嵌套，guard 只覆盖满足条件的值：

```tspp
const score = match screen {
  Idle | Loading => 0,
  Finished(Success(value)) if value > 0 => value,
  Finished(Success(_)) => 0,
  Finished(Failure(code)) => -code,
};
```

支持递归数据类型的模式匹配以及解构：

```tspp
// 递归计算 List 长度
function listLength(list: List<number>): number {
  return match list {
    Nil => 0,
    Cons(_, tail) => 1 + listLength(tail),
  };
}

// 解构 Option 取值
function unwrapOr<T>(opt: Option<T>, defaultValue: T): T {
  return match opt {
    None => defaultValue,
    Some(val) => val,
  };
}
```

## 名义性与边界

两种声明的名义性都由编译器内部的品牌属性实现。品牌不会出现在：

- `keyof` 的结果中；
- 诊断消息中；
- hover 的类型文本中。

显式 `as` 仍然可以覆盖名义检查，因为它不执行结构兼容检查：

```tspp
const stolen: UserId = 1 as UserId;
```

## 运行与实验

在仓库根目录按 `F5`，选择 **TS++: VS Code Extension**，再通过窗口左下角的 **TS++ Examples** 状态栏按钮选择本例。

也可以在仓库根目录构建 compiler 后，进入本目录运行：

```powershell
npm run check
npm run emit-declarations
```

`index.tspp` 中的反例由 `// @ts-expect-error` 保护：它们会触发语言服务的诊断，同时仍能让整个示例通过检查。如果某个反例不再报错，编译器会报告该指令未使用。

## 特性开关

`tsppconfig.json` 必须显式开启 `newtypeDeclarations` 与 `dataDeclarations`，编译器不会自动开启。

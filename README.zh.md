# ts-plus-plus

[English](README.md) | **简体中文**

> [#](https://github.com/biyuehu/ts-plus-plus/issues/2) 中的设计提案仅用于演示，并非计划，也不是 TODO，更不构成承诺。可以把它看作一种可能方向的预览，而非路线图。

ts-plus-plus 是一门受 TypeScript 启发的实验性编程语言。

它希望保留 TypeScript 中适合类型化应用开发的体验，例如熟悉的语法、渐进式的使用方式和实用的工具支持，同时为不同的语言设计留下空间。

## 方向

ts-plus-plus 与 TypeScript 相似，但不以成为 TypeScript 的超集为目标。项目不承诺兼容所有 TypeScript 程序；当不同的语法、语义或类型规则能够带来更一致的设计时，语言可以主动做出不同选择。

这门语言也不承诺类型一定会被擦除，更不把编译限定为“删除类型后得到等价的 JavaScript”。如果语言设计需要，类型信息可以参与编译、代码转换或运行时行为。输出形式是实现层面的选择，而不是这门语言的定义。

## 理念

- 保持熟悉感，但不受兼容性约束。
- 将类型视为语言设计的一等组成部分。
- 相比历史行为，更重视清晰、一致的语义。
- 在语言逐渐成形的过程中保留实验空间。

项目目前仍处于早期阶段。这个仓库用于探索上述方向，不代表兼容性承诺，也不是已经定稿的语言规范。

## 协议

Apache 许可证 2.0。tsplusplus 派生自 Microsoft 的 TypeScript；原始许可证、版权声明和 NOTICE 保持不变，修改过的文件将被标记为已修改。“TypeScript”是 Microsoft Corporation 的商标。

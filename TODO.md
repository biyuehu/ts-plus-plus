# TS++ 项目任务规划 (TODO)

## 1. 贡献者头像墙自动更新策略设计

- **项目定位考量**：
  - TS++ 是基于 TypeScript 语法外壳并深度自研类型论核心（MLTT 类型宇宙、Z3 形式化验证、Dependent Types 等）的独立新语言，不与 TypeScript 官方主干做后续同步。
  - 上游分叉点（Commit `050880ce`）为绝对固化的历史基准线，天然阻断上游几千名历史贡献者。
- **CI/CD 自动化更新流程**：
  - **触发条件**：
    - 代码合并入 `main` 分支时（`push: branches: [main]`）。
    - 周期性定时调度（如每周一通过 GitHub Actions Cron 触发一次）。
  - **执行步骤**：
    1. GitHub Actions 检出仓库代码（`actions/checkout@v4`）。
    2. 设置 Node.js 环境并安装必要依赖。
    3. 运行 `npm run contributors` 生成最新的 [`assets/contributors.svg`](assets/contributors.svg)。
    4. 检查是否有文件 Diff，若有变动则通过 `stefanzweifel/git-auto-commit-action` 或标准 git 命令自动提交并推回仓库。

## 2. 优化 Markdownlint 提示

- **背景与现状**：
  - [README.md](README.md) 与 [README.zh.md](README.zh.md) 中用于展示贡献者墙的标签采用了 `<a href="..."> <img src="..." /> </a>`，在部分编辑器或 CI 检查工具中容易触发 `MD033 (no-inline-html)` 告警。
- **改进措施**：
  - **方案 A（格式兼容）**：改用纯 Markdown 语法形式链接图片：
    ```markdown
    [![Contributors](assets/contributors.svg)](https://github.com/biyuehu/tsplus/graphs/contributors)
    ```
  - **方案 B（规则放宽）**：在 `.markdownlint.json` 或 `.markdownlintrc` 中对 `MD033` 增加白名单允许项，允许安全展示 `<a>` 和 `<img>` 标签。

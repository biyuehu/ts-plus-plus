import { rmSync } from "node:fs";

// 固定从本脚本位置解析，只清理这个示例自己的生成目录。
rmSync(new URL("../dist/", import.meta.url), { recursive: true, force: true });

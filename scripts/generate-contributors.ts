import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

interface ContributorInfo {
  login: string;
  name?: string;
  avatarUrl: string;
  avatarBase64: string;
  profileUrl: string;
  commits?: number;
}

// 常见 Git 提交邮箱/名字到 GitHub 用户名的映射
const KNOWN_GIT_USER_MAP: Record<string, string> = {
  "biyuehuya@gmail.com": "biyuehu",
  "romi": "biyuehu",
  "2451759073@qq.com": "lsby",
  "lsby": "lsby",
};

// 常见 Bot 黑名单
const DEFAULT_BLACKLIST = new Set([
  "dependabot[bot]",
  "github-actions[bot]",
]);

/**
 * 从本地 git 仓库中分析自上游 Fork 点以来的所有贡献者（动态白名单提取）
 */
function getForkContributorsFromGit(): Map<string, number> {
  const commitCounts = new Map<string, number>();

  let forkBase = "";
  for (const candidate of ["upstream/release-6.0", "050880ce"]) {
    try {
      forkBase = execSync(`git merge-base ${candidate} HEAD`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (forkBase) break;
    }
    catch {
      // 尝试下一个稳定的上游基准；不要使用 origin/main，因为在 main 上它通常等于 HEAD。
    }
  }

  const range = forkBase ? `${forkBase}..HEAD` : "HEAD";
  try {
    const logOutput = execSync(`git log ${range} --format="%an|%ae"`, { encoding: "utf8" });
    for (const line of logOutput.split(/\r?\n/)) {
      if (!line.trim()) continue;
      const [name, email] = line.split("|");
      const cleanName = (name || "").trim().toLowerCase();
      const cleanEmail = (email || "").trim().toLowerCase();

      const githubLogin = KNOWN_GIT_USER_MAP[cleanEmail] ||
        KNOWN_GIT_USER_MAP[cleanName] ||
        cleanName;

      if (githubLogin && !DEFAULT_BLACKLIST.has(githubLogin.toLowerCase())) {
        commitCounts.set(githubLogin, (commitCounts.get(githubLogin) || 0) + 1);
      }
    }
  }
  catch (e) {
    console.warn("无法从 git log 解析贡献者，将使用默认名单:", e);
    commitCounts.set("biyuehu", 1);
    commitCounts.set("lsby", 1);
  }

  return commitCounts;
}

/**
 * 获取 GitHub 用户的头像并转为 Base64，以保证生成的 SVG 在离线/GitHub 任意渲染场景均自包含展示
 */
async function fetchUserContributor(
  login: string,
  commits?: number,
): Promise<ContributorInfo | undefined> {
  try {
    console.log(`正在获取 GitHub 用户信息: ${login}...`);
    const userRes = await fetch(`https://api.github.com/users/${login}`, {
      headers: {
        "User-Agent": "tsplus-contributor-generator",
        "Accept": "application/vnd.github.v3+json",
      },
    });

    if (!userRes.ok) {
      console.warn(`获取用户 ${login} 失败 (${userRes.status}): ${userRes.statusText}`);
      // 回退使用通用头像 URL
      const avatarUrl = `https://github.com/${login}.png`;
      const imgRes = await fetch(avatarUrl);
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
      return {
        login,
        avatarUrl,
        avatarBase64: `data:image/png;base64,${imgBuffer.toString("base64")}`,
        profileUrl: `https://github.com/${login}`,
        commits,
      };
    }

    const userData = (await userRes.json()) as {
      login: string;
      name?: string;
      avatar_url: string;
      html_url: string;
    };

    // 下载头像图片并转为 base64
    const avatarRes = await fetch(`${userData.avatar_url}&size=128`);
    const avatarBuffer = Buffer.from(await avatarRes.arrayBuffer());
    const mimeType = avatarRes.headers.get("content-type") || "image/png";
    const avatarBase64 = `data:${mimeType};base64,${avatarBuffer.toString("base64")}`;

    return {
      login: userData.login,
      name: userData.name || userData.login,
      avatarUrl: userData.avatar_url,
      avatarBase64,
      profileUrl: userData.html_url,
      commits,
    };
  }
  catch (err) {
    console.error(`处理贡献者 ${login} 失败:`, err);
    return undefined;
  }
}

/**
 * 生成现代感、自包含且支持点击跳转的 SVG 贡献者头像墙
 */
function generateContributorSvg(contributors: ContributorInfo[]): string {
  const avatarSize = 64;
  const avatarRadius = avatarSize / 2;
  const gap = 20;
  const paddingX = 24;
  const paddingY = 24;
  const columns = Math.min(Math.max(contributors.length, 1), 8);
  const rows = Math.ceil(contributors.length / columns);

  const cardWidth = avatarSize + 16;
  const cardHeight = avatarSize + 28;

  const totalWidth = paddingX * 2 + columns * cardWidth + (columns - 1) * gap;
  const totalHeight = paddingY * 2 + rows * cardHeight + (rows - 1) * gap;

  let defs = `
  <defs>
    <style>
      .avatar-card {
        transition: transform 0.2s ease-in-out;
      }
      .avatar-card:hover {
        transform: translateY(-3px);
      }
      .avatar-img {
        border-radius: 50%;
      }
      .username {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        font-size: 12px;
        font-weight: 500;
        fill: #57606a;
        text-anchor: middle;
      }
      @media (prefers-color-scheme: dark) {
        .username {
          fill: #8b949e;
        }
      }
    </style>
  `;

  // 为每个贡献者生成剪裁路径（圆形）
  contributors.forEach((c, index) => {
    defs += `
    <clipPath id="clip-${index}">
      <circle cx="${avatarRadius}" cy="${avatarRadius}" r="${avatarRadius}" />
    </clipPath>`;
  });
  defs += `\n  </defs>`;

  let content = "";
  contributors.forEach((c, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = paddingX + col * (cardWidth + gap);
    const y = paddingY + row * (cardHeight + gap);

    const commitBadge = c.commits ? ` (${c.commits} commits)` : "";

    content += `
  <g class="avatar-card" transform="translate(${x}, ${y})">
    <a href="${c.profileUrl}" target="_blank" rel="noopener noreferrer">
      <title>${c.name || c.login}${commitBadge}</title>
      <!-- 头像外边框阴影 -->
      <circle cx="${cardWidth / 2}" cy="${avatarRadius}" r="${avatarRadius + 1.5}" fill="none" stroke="#d0d7de" stroke-width="1.5" />
      <!-- 头像图片（Base64 自包含，裁剪为圆形） -->
      <g transform="translate(${(cardWidth - avatarSize) / 2}, 0)" clip-path="url(#clip-${index})">
        <image href="${c.avatarBase64}" width="${avatarSize}" height="${avatarSize}" />
      </g>
      <!-- 用户名标签 -->
      <text class="username" x="${cardWidth / 2}" y="${avatarSize + 18}">${c.login}</text>
    </a>
  </g>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" fill="none">
${defs}
${content}
</svg>
`;
}

async function main() {
  const args = process.argv.slice(2);
  let whitelist: string[] = [];
  const blacklist = new Set(DEFAULT_BLACKLIST);

  for (const arg of args) {
    if (arg.startsWith("--whitelist=")) {
      whitelist = arg.replace("--whitelist=", "").split(",").map(s => s.trim()).filter(Boolean);
    }
    else if (arg.startsWith("--blacklist=")) {
      for (const b of arg.replace("--blacklist=", "").split(",")) {
        blacklist.add(b.trim().toLowerCase());
      }
    }
  }

  const gitContributors = getForkContributorsFromGit();

  // 如果没有显式传 --whitelist，则基于 git 动态提取的贡献者（天然剔除上游贡献者）
  let targetLogins: { login: string; commits?: number; }[] = [];

  if (whitelist.length > 0) {
    targetLogins = whitelist.map(login => ({
      login,
      commits: gitContributors.get(login),
    }));
  }
  else {
    // 按 commit 数排序
    const sorted = Array.from(gitContributors.entries()).sort((a, b) => b[1] - a[1]);
    for (const [login, commits] of sorted) {
      if (!blacklist.has(login.toLowerCase())) {
        targetLogins.push({ login, commits });
      }
    }
  }

  // 保证至少有已知核心作者（如果 git 统计为空）
  if (targetLogins.length === 0) {
    targetLogins = [{ login: "biyuehu" }, { login: "lsby" }];
  }

  console.log("准备生成贡献者墙，目标列表:", targetLogins.map(t => `${t.login} (${t.commits || 0} commits)`).join(", "));

  const contributors: ContributorInfo[] = [];
  for (const target of targetLogins) {
    const info = await fetchUserContributor(target.login, target.commits);
    if (info) {
      contributors.push(info);
    }
  }

  if (contributors.length === 0) {
    console.error("未能获取任何贡献者信息！");
    process.exit(1);
  }

  const svgContent = generateContributorSvg(contributors);

  const assetsDir = path.resolve(__dirname, "../assets");
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const outputPath = path.join(assetsDir, "contributors.svg");
  fs.writeFileSync(outputPath, svgContent, "utf8");
  console.log(`成功生成贡献者头像墙 SVG: ${outputPath}`);
}

main().catch(err => {
  console.error("生成失败:", err);
  process.exit(1);
});

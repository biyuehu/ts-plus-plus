import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import url from "url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KNOWN_GIT_USER_MAP = {
  "biyuehuya@gmail.com": "biyuehu",
  "romi": "biyuehu",
  "2451759073@qq.com": "lsby",
  "lsby": "lsby",
};

const DEFAULT_BLACKLIST = new Set([
  "dependabot[bot]",
  "github-actions[bot]",
]);

function loadUpstreamBlacklist() {
  const blacklist = new Set(DEFAULT_BLACKLIST);
  const cachePath = path.resolve(__dirname, "upstream-contributors.json");
  if (!fs.existsSync(cachePath)) {
    return blacklist;
  }

  try {
    const raw = fs.readFileSync(cachePath, "utf8");
    const data = JSON.parse(raw);
    for (const login of data.logins || []) {
      blacklist.add(login.toLowerCase());
    }
    for (const email of data.emails || []) {
      blacklist.add(email.toLowerCase());
    }
  }
  catch {
    // Ignore cache parse error.
  }

  return blacklist;
}

function getForkContributorsFromGit(blacklist) {
  const commitCounts = new Map();

  let forkBase = "";
  try {
    forkBase = execSync("git merge-base upstream/release-6.0 HEAD", { encoding: "utf8" }).trim();
  }
  catch {
    try {
      forkBase = execSync("git merge-base origin/main HEAD", { encoding: "utf8" }).trim();
    }
    catch {
      forkBase = "";
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

      if (blacklist.has(cleanEmail) || blacklist.has(cleanName)) {
        continue;
      }

      const login = KNOWN_GIT_USER_MAP[cleanEmail] || KNOWN_GIT_USER_MAP[cleanName] || cleanName;
      if (login && !blacklist.has(login.toLowerCase())) {
        commitCounts.set(login, (commitCounts.get(login) || 0) + 1);
      }
    }
  }
  catch {
    commitCounts.set("biyuehu", 1);
    commitCounts.set("lsby", 1);
  }

  return commitCounts;
}

async function fetchUserContributor(login, commits, cached) {
  if (cached && cached.avatarBase64) {
    return {
      ...cached,
      commits,
    };
  }

  try {
    const headers = {
      "User-Agent": "tsplus-contributor-generator",
      "Accept": "application/vnd.github.v3+json",
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const res = await fetch(`https://api.github.com/users/${login}`, { headers });
    let avatarUrl = `https://github.com/${login}.png`;
    let name = login;
    let profileUrl = `https://github.com/${login}`;

    if (res.ok) {
      const data = await res.json();
      avatarUrl = data.avatar_url;
      name = data.name || data.login;
      profileUrl = data.html_url;
    }

    const imgRes = await fetch(`${avatarUrl}${avatarUrl.includes("?") ? "&" : "?"}size=128`);
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const mimeType = imgRes.headers.get("content-type") || "image/png";
    const avatarBase64 = `data:${mimeType};base64,${imgBuffer.toString("base64")}`;

    return {
      login,
      name,
      avatarUrl,
      avatarBase64,
      profileUrl,
      commits,
    };
  }
  catch {
    return undefined;
  }
}

function generateContributorSvg(contributors) {
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

  contributors.forEach((_, index) => {
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
      <circle cx="${cardWidth / 2}" cy="${avatarRadius}" r="${avatarRadius + 1.5}" fill="none" stroke="#d0d7de" stroke-width="1.5" />
      <g transform="translate(${(cardWidth - avatarSize) / 2}, 0)" clip-path="url(#clip-${index})">
        <image href="${c.avatarBase64}" width="${avatarSize}" height="${avatarSize}" />
      </g>
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
  const force = args.includes("--force");
  let whitelist = [];

  for (const arg of args) {
    if (arg.startsWith("--whitelist=")) {
      whitelist = arg.replace("--whitelist=", "").split(",").map(s => s.trim()).filter(Boolean);
    }
  }

  const upstreamBlacklist = loadUpstreamBlacklist();
  const gitContributors = getForkContributorsFromGit(upstreamBlacklist);

  let targetLogins = [];
  if (whitelist.length > 0) {
    targetLogins = whitelist.map(login => ({
      login,
      commits: gitContributors.get(login),
    }));
  }
  else {
    const sorted = Array.from(gitContributors.entries()).sort((a, b) => b[1] - a[1]);
    for (const [login, commits] of sorted) {
      if (!upstreamBlacklist.has(login.toLowerCase())) {
        targetLogins.push({ login, commits });
      }
    }
  }

  if (targetLogins.length === 0) {
    targetLogins = [{ login: "biyuehu" }, { login: "lsby" }];
  }

  const assetsDir = path.resolve(__dirname, "../assets");
  const cachePath = path.join(assetsDir, "contributors.json");
  const svgPath = path.join(assetsDir, "contributors.svg");

  const existingCache = {};
  if (fs.existsSync(cachePath)) {
    try {
      const list = JSON.parse(fs.readFileSync(cachePath, "utf8"));
      for (const item of list) {
        existingCache[item.login.toLowerCase()] = item;
      }
    }
    catch {
      // Ignore cache read errors.
    }
  }

  const isUpToDate = !force
    && fs.existsSync(svgPath)
    && targetLogins.length === Object.keys(existingCache).length
    && targetLogins.every(t => {
      const cached = existingCache[t.login.toLowerCase()];
      return cached && cached.commits === t.commits;
    });

  if (isUpToDate) {
    console.log("Contributors are already up to date.");
    return;
  }

  const contributors = [];
  for (const target of targetLogins) {
    const cached = existingCache[target.login.toLowerCase()];
    const info = await fetchUserContributor(target.login, target.commits, cached);
    if (info) {
      contributors.push(info);
    }
  }

  if (contributors.length === 0) {
    process.exit(1);
  }

  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const svgContent = generateContributorSvg(contributors);
  fs.writeFileSync(svgPath, svgContent, "utf8");
  fs.writeFileSync(cachePath, JSON.stringify(contributors, undefined, 2) + "\n", "utf8");

  console.log(`Updated contributors (${contributors.length} contributors).`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

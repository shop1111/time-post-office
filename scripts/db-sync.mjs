#!/usr/bin/env node
/**
 * 把所有 SQLite 库同步到 prisma/schema.prisma 的最新结构：
 *   data/template.db（新用户的模板）、data/auth.db（账号）、data/users/<id>/app.db（每个用户）
 *
 * 部署 / 升级后、启动服务前运行：npm run db:push
 * 遇到会丢数据的结构变更时 prisma 会拒绝并退出，不会悄悄删数据。
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
if (!existsSync(prismaCli)) {
  console.error("找不到 prisma 命令行，请先运行 npm install");
  process.exit(1);
}

mkdirSync(path.join(dataDir, "users"), { recursive: true });
const targets = [path.join(dataDir, "template.db"), path.join(dataDir, "auth.db")];
for (const id of readdirSync(path.join(dataDir, "users"))) {
  const file = path.join(dataDir, "users", id, "app.db");
  if (existsSync(file)) targets.push(file);
}

let failed = 0;
for (const file of targets) {
  const url = `file:${file.replace(/\\/g, "/")}`;
  process.stdout.write(`同步 ${path.relative(root, file)} … `);
  try {
    execFileSync(process.execPath, [prismaCli, "db", "push", "--skip-generate"], {
      env: { ...process.env, DATABASE_URL: url },
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("完成");
  } catch (e) {
    failed++;
    console.log("失败");
    console.error(String(e.stdout ?? "") + String(e.stderr ?? ""));
  }
}

if (existsSync(path.join(dataDir, "app.db"))) {
  console.log("\n提示：发现单用户版本留下的 data/app.db。注册账号后可运行");
  console.log("  npm run user:adopt-legacy -- <用户名>");
  console.log("把它（连同 data/uploads 里的照片和语音）归到这个账号下。");
}

if (failed) {
  console.error(`\n${failed} 个库同步失败`);
  process.exit(1);
}
console.log(`\n全部 ${targets.length} 个库已是最新结构`);

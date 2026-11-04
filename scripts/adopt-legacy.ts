/**
 * 把单用户版本的数据（data/app.db + data/uploads/）归到一个已注册的账号下。
 *   npm run user:adopt-legacy -- <用户名>
 *
 * 只在该账号还没有任何胶囊、信件时执行；原文件会先备份成 app.db.adopted-<时间戳>。
 * 运行前请先停掉服务。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync } from "fs";
import path from "path";
import { authDb, DATA_DIR, disconnectAll, runAsUser, userDbFile, userUploadDir } from "../src/lib/tenancy";
import { db } from "../src/lib/db";
import { normalizeUsername } from "../src/lib/username";

async function main() {
  const username = normalizeUsername(process.argv[2]);
  if (!username) throw new Error("用法：npm run user:adopt-legacy -- <用户名>");
  const legacyDb = path.join(DATA_DIR, "app.db");
  if (!existsSync(legacyDb)) throw new Error(`找不到 ${legacyDb}`);
  const user = await authDb.user.findUnique({ where: { username } });
  if (!user) throw new Error(`没有用户 ${username}，请先在网页上注册`);

  const counts = await runAsUser(user.id, () => Promise.all([db.entry.count(), db.letter.count()]));
  if (counts[0] + counts[1] > 0) throw new Error(`账号 ${username} 已经有数据了，为了不覆盖，停止导入`);
  await disconnectAll();

  const target = userDbFile(user.id);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    if (existsSync(target + suffix)) renameSync(target + suffix, `${target}${suffix}.replaced-${stamp}`);
  }
  copyFileSync(legacyDb, target);
  renameSync(legacyDb, `${legacyDb}.adopted-${stamp}`);

  const legacyUploads = path.join(DATA_DIR, "uploads");
  const uploads = userUploadDir(user.id);
  mkdirSync(uploads, { recursive: true });
  let moved = 0;
  if (existsSync(legacyUploads)) {
    for (const name of readdirSync(legacyUploads)) {
      if (name.startsWith(".")) continue;
      renameSync(path.join(legacyUploads, name), path.join(uploads, name));
      moved++;
    }
  }
  console.log(`已把旧数据归到 ${username} 名下（移动了 ${moved} 个上传文件）。`);
  console.log("接着运行 npm run db:push，把这份库同步到最新结构。");
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => disconnectAll());

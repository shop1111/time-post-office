import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Windows 上断开连接后 SQLite 文件可能还被锁一小会儿：只对「被占用」重试，其他错误照常抛出。 */
async function removeWhenReleased(remove: () => void) {
  for (let attempt = 0; ; attempt++) {
    try { remove(); return; }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (attempt >= 30 || (code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY")) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export function testDatabase(label: string) {
  const directory = mkdtempSync(join(tmpdir(), `time-post-office-${label}-`));
  const url = `file:${join(directory, "test.db").replace(/\\/g, "/")}`;
  const db = new PrismaClient({ datasources: { db: { url } } });
  return {
    db,
    setup() {
      execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
        env: { ...process.env, DATABASE_URL: url, RUST_LOG: "info", RUST_BACKTRACE: "1" }, stdio: "pipe", timeout: 120_000, // 刚克隆、多个测试文件并行建库时，30 秒不够
      });
    },
    async cleanup() {
      await db.$disconnect();
      for (const name of ["test.db", "test.db-journal", "test.db-wal", "test.db-shm"]) {
        const path = join(directory, name);
        if (existsSync(path)) await removeWhenReleased(() => unlinkSync(path));
      }
      await removeWhenReleased(() => rmdirSync(directory));
    },
  };
}

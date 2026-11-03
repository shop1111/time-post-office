import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function testDatabase(label: string) {
  const directory = mkdtempSync(join(tmpdir(), `time-post-office-${label}-`));
  const url = `file:${join(directory, "test.db").replace(/\\/g, "/")}`;
  const db = new PrismaClient({ datasources: { db: { url } } });
  return {
    db,
    setup() {
      execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
        env: { ...process.env, DATABASE_URL: url, RUST_LOG: "info", RUST_BACKTRACE: "1" }, stdio: "pipe", timeout: 30_000,
      });
    },
    async cleanup() {
      await db.$disconnect();
      for (const name of ["test.db", "test.db-journal", "test.db-wal", "test.db-shm"]) {
        const path = join(directory, name);
        if (existsSync(path)) unlinkSync(path);
      }
      rmdirSync(directory);
    },
  };
}

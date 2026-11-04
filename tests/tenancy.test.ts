import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "time-post-office-tenancy-"));
process.env.DATA_DIR = dir;

type Tenancy = typeof import("@/lib/tenancy");
type Db = typeof import("@/lib/db");
let tenancy: Tenancy;
let dbm: Db;

beforeAll(async () => {
  const url = `file:${join(dir, "template.db").replace(/\\/g, "/")}`;
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", timeout: 60_000 });
  tenancy = await import("@/lib/tenancy");
  dbm = await import("@/lib/db");
}, 90_000);

afterAll(async () => {
  await tenancy?.disconnectAll();
  rmSync(dir, { recursive: true, force: true });
});

describe("多用户数据隔离", () => {
  it("没有登录用户时访问数据库直接报错，不会落到任何默认库", () => {
    expect(() => dbm.db.entry).toThrow(dbm.NoUserScopeError);
  });

  it("两个用户各自读写自己的库", async () => {
    const { runAsUser } = tenancy;
    const { db } = dbm;
    await runAsUser("useraaaaaaaa", () => db.entry.create({ data: { type: "text", text: "A 的胶囊", occurredAt: new Date() } }));
    await runAsUser("userbbbbbbbb", () => db.entry.create({ data: { type: "text", text: "B 的胶囊", occurredAt: new Date() } }));
    const a = await runAsUser("useraaaaaaaa", () => db.entry.findMany());
    const b = await runAsUser("userbbbbbbbb", () => db.entry.findMany());
    expect(a.map((e) => e.text)).toEqual(["A 的胶囊"]);
    expect(b.map((e) => e.text)).toEqual(["B 的胶囊"]);
  });

  it("并发请求和事务里也不会串库", async () => {
    const { runAsUser } = tenancy;
    const { db } = dbm;
    const counts = await Promise.all(["useraaaaaaaa", "userbbbbbbbb", "usercccccccc"].map((id) =>
      runAsUser(id, async () => {
        await new Promise((r) => setTimeout(r, 5));
        await db.$transaction(async (tx) => {
          await tx.setting.upsert({ where: { key: "owner" }, create: { key: "owner", value: id }, update: { value: id } });
        });
        await new Promise((r) => setTimeout(r, 5));
        return (await db.setting.findUniqueOrThrow({ where: { key: "owner" } })).value;
      })));
    expect(counts).toEqual(["useraaaaaaaa", "userbbbbbbbb", "usercccccccc"]);
  });

  it("拒绝可疑的用户 id，防止路径穿越", () => {
    expect(() => tenancy.userDir("../etc")).toThrow();
    expect(() => tenancy.userDir("a/b")).toThrow();
  });
});

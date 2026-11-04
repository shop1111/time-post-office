import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { testDatabase } from "./helpers/database";
import { db } from "@/lib/db";
import { embed } from "@/lib/ai/provider";
import { retrieve } from "@/lib/memory/retrieve";
import { embedLite, toBytes } from "@/lib/memory/embed-lite";

const f = vi.hoisted(() => ({ fixture: undefined as unknown as ReturnType<typeof testDatabase>, beforeTouch: undefined as (() => Promise<void>) | undefined }));
vi.mock("@/lib/db", async () => {
  const { testDatabase } = await import("./helpers/database"); f.fixture = testDatabase("memory-background");
  return { db: f.fixture.db.$extends({ query: { memory: {
    async updateMany({ args, query }) {
      if (args.data.recallCount && f.beforeTouch) { const change = f.beforeTouch; f.beforeTouch = undefined; await change(); }
      return query(args);
    },
  } } }) };
});
vi.mock("@/lib/ai/provider", async (original) => {
  const actual = await original<typeof import("@/lib/ai/provider")>();
  return { ...actual, embed: vi.fn(actual.embed) };
});
const realEmbed = vi.mocked(embed).getMockImplementation()!;
const now = new Date("2026-11-04T12:00:00Z");
beforeAll(() => f.fixture.setup(), 30_000);
beforeEach(async () => {
  vi.restoreAllMocks(); vi.stubEnv("EMBED_MODE", "lite");
  f.beforeTouch = undefined;
  vi.mocked(embed).mockReset().mockImplementation(realEmbed);
  await db.memory.deleteMany();
});
afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await f.fixture.cleanup(); });

it("有效记忆补向量并计数；人工编辑记忆仍检索但不写向量或计数；撤回不参与", async () => {
  const plain = await db.memory.create({ data: { content: "今天去杭州散步", kind: "event", occurredAt: now } });
  const edited = await db.memory.create({ data: { content: "用户更正的杭州之行", kind: "event", occurredAt: now, userEdited: true, revision: 1 } });
  await db.memory.create({ data: { content: "已撤回的杭州之行", kind: "event", occurredAt: now, status: "retracted" } });
  const result = await retrieve({ query: "杭州", now });
  expect(result.map((r) => r.id).sort()).toEqual([plain.id, edited.id].sort());
  expect(await db.memory.findUniqueOrThrow({ where: { id: plain.id } })).toMatchObject({ recallCount: 1, lastRecalledAt: now });
  expect((await db.memory.findUniqueOrThrow({ where: { id: plain.id } })).embedding).not.toBeNull();
  expect(await db.memory.findUniqueOrThrow({ where: { id: edited.id } })).toMatchObject({ embedding: null, recallCount: 0, lastRecalledAt: null });
});

it.each(["correct", "retract", "delete", "revision"] as const)("补向量等待期间%s：不回写或返回旧版本", async (change) => {
  const row = await db.memory.create({ data: { content: "原有记忆", kind: "event", occurredAt: now } });
  vi.mocked(embed).mockImplementationOnce(async (...args) => {
    if (change === "delete") await db.memory.delete({ where: { id: row.id } });
    else await db.memory.update({ where: { id: row.id }, data: change === "correct"
      ? { content: "用户更正内容", userEdited: true, revision: 1 }
      : change === "retract" ? { status: "retracted" } : { revision: 1 } });
    return realEmbed(...args);
  });
  expect(await retrieve({ query: "记忆", now })).toEqual([]);
  const current = await db.memory.findUnique({ where: { id: row.id } });
  if (change === "delete") expect(current).toBeNull();
  else expect(current).toMatchObject({ embedding: null, recallCount: 0 });
});

it("排序完成后版本变化，召回计数的CAS仍拒绝旧版本", async () => {
  const row = await db.memory.create({ data: { content: "原有记忆", kind: "event", occurredAt: now, embedding: toBytes(embedLite("原有记忆")) } });
  f.beforeTouch = async () => {
    await db.memory.update({ where: { id: row.id }, data: { revision: 1 } });
  };
  await retrieve({ query: "记忆", now });
  expect(await db.memory.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ recallCount: 0, revision: 1 });
});

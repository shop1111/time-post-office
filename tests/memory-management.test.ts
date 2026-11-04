import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ db: null as unknown as PrismaClient }));
vi.mock("@/lib/db", () => ({
  get db() { return context.db; },
  parseJson: (value: string | null | undefined, fallback: unknown) => {
    try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
  },
}));
vi.mock("@/lib/ai/json", () => ({ chatJson: vi.fn(async (_schema, _messages, opts) => opts.mock()) }));
vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/ai/provider")>();
  const { embedLite } = await import("@/lib/memory/embed-lite");
  return { ...original, embed: vi.fn(async (texts: string[]) => texts.map(embedLite)) };
});

import { correctMemory, retractMemory } from "@/lib/memory/manage";
import { getProfile, refreshProfile } from "@/lib/memory/profile";
import { buildMemoryGraph } from "@/lib/memory/graph";
import { DERIVED_REVISION_KEY, PROFILE_REVISION_KEY } from "@/lib/memory/consistency";
import { buildRecap, getCachedRecap } from "@/lib/story";
import { chatJson } from "@/lib/ai/json";
import { embed } from "@/lib/ai/provider";
import { embedLite, fromBytes, cosine, toBytes } from "@/lib/memory/embed-lite";
import { PATCH, DELETE } from "@/app/api/memories/[id]/route";
import { POST as refreshProfileRoute } from "@/app/api/profile/route";

const root = fileURLToPath(new URL("../", import.meta.url));
const tempDir = mkdtempSync(path.join(os.tmpdir(), "time-post-office-management-"));
const db = new PrismaClient({ datasources: { db: { url: `file:${path.join(tempDir, "test.db").replaceAll("\\", "/")}` } } });
const date = new Date("2026-10-15T12:00:00");
const params = { params: Promise.resolve({ id: "m1" }) };

beforeAll(async () => {
  context.db = db;
  await db.$queryRaw`SELECT 1`;
  execFileSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: `file:${path.join(tempDir, "test.db").replaceAll("\\", "/")}`, CHECKPOINT_DISABLE: "1" },
    stdio: "pipe", timeout: 30_000,
  });
}, 45_000);

afterAll(async () => {
  await db.$disconnect();
  if (path.dirname(tempDir) === path.resolve(os.tmpdir()) && path.basename(tempDir).startsWith("time-post-office-management-")) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

beforeEach(async () => {
  vi.mocked(chatJson).mockReset().mockImplementation(async (_schema, _messages, opts) => opts.mock());
  vi.mocked(embed).mockReset().mockImplementation(async (texts) => texts.map(embedLite));
  await db.memoryEntity.deleteMany();
  await db.memory.deleteMany();
  await db.entryMessage.deleteMany();
  await db.storyCard.deleteMany();
  await db.entry.deleteMany();
  await db.entity.deleteMany();
  await db.profile.deleteMany();
  await db.setting.deleteMany();
  await db.monthlyRecap.deleteMany();
  await db.profile.create({ data: { summary: "旧画像中的独有秘密", traits: '["旧标签"]', style: '{"avgSentenceLen":10,"samples":["旧文风秘密"]}' } });
  await db.setting.createMany({ data: [{ key: DERIVED_REVISION_KEY, value: "0" }, { key: PROFILE_REVISION_KEY, value: "0" }] });
  await db.entry.createMany({ data: [
    { id: "e1", type: "text", text: "不能带回画像的旧原文秘密", occurredAt: date },
    { id: "e2", type: "text", text: "今天和阿哲在西湖散步，好开心。", occurredAt: date },
  ] });
  await db.memory.createMany({ data: [
    { id: "m1", entryId: "e1", kind: "fact", content: "需要撤回的独有记忆秘密", importance: 8, occurredAt: date, embedding: toBytes(embedLite("需要撤回的独有记忆秘密")) },
    { id: "m2", entryId: "e2", kind: "event", content: "和阿哲在西湖散步", importance: 7, occurredAt: date },
  ] });
  await db.entity.createMany({ data: [
    { id: "person", name: "阿哲", type: "person" },
    { id: "old-place", name: "旧地点", type: "place" },
    { id: "lake", name: "西湖", type: "place" },
  ] });
  await db.memoryEntity.createMany({ data: [
    { memoryId: "m1", entityId: "person" }, { memoryId: "m1", entityId: "old-place" },
    { memoryId: "m2", entityId: "person" }, { memoryId: "m2", entityId: "lake" },
  ] });
  await db.monthlyRecap.create({ data: { month: "2026-10", payload: '{"title":"旧月度缓存秘密"}' } });
});

describe("correction and withdrawal", () => {
  it("atomically replaces text/vector/entity links, retains shared entities and invalidates derivatives", async () => {
    const result = await correctMemory("m1", {
      expectedRevision: 0, content: "小鹿是我的同学", importance: 9,
      entities: [{ name: " 小鹿 ", type: "person" }, { name: "小鹿", type: "person" }],
    });
    expect(result.memory).toMatchObject({ content: "小鹿是我的同学", importance: 9, revision: 1, status: "active", userEdited: true });
    expect(cosine(fromBytes(result.memory.embedding)!, embedLite("小鹿是我的同学"))).toBeCloseTo(1);
    expect(result.memory.entities.map((e) => e.entity.name)).toEqual(["小鹿"]);
    expect(await db.entity.findUnique({ where: { id: "old-place" } })).toBeNull();
    expect(await db.entity.findUnique({ where: { id: "person" } })).not.toBeNull();
    expect(await db.memory.findUnique({ where: { id: "m2" } })).toMatchObject({ revision: 0, userEdited: false });
    expect(await db.monthlyRecap.count()).toBe(0);
    expect((await getProfile()).isStale).toBe(true);
  });

  it("requires a revision and rejects invalid or unsupported changes without mutation", async () => {
    for (const input of [{ content: "新内容" }, { expectedRevision: 0, content: " " }, { expectedRevision: 0, importance: 11 }, { expectedRevision: 0, status: "retracted" }, { expectedRevision: 0 }]) {
      await expect(correctMemory("m1", input)).rejects.toBeDefined();
    }
    expect(await db.memory.findUnique({ where: { id: "m1" } })).toMatchObject({ revision: 0, userEdited: false });
  });

  it("rejects stale editors instead of overwriting the first correction", async () => {
    await correctMemory("m1", { expectedRevision: 0, content: "第一次更正" });
    await expect(correctMemory("m1", { expectedRevision: 0, content: "过期草稿" })).rejects.toMatchObject({ status: 409 });
    expect(await db.memory.findUnique({ where: { id: "m1" } })).toMatchObject({ content: "第一次更正", revision: 1 });
  });

  it("withdraws without deleting provenance and makes repeated DELETE idempotent", async () => {
    const first = await retractMemory("m1", { expectedRevision: 0 });
    const second = await retractMemory("m1", { expectedRevision: 0 });
    expect(first.memory).toMatchObject({ status: "retracted", revision: 1, userEdited: true, entryId: "e1" });
    expect(first.memory.retractedAt).toBeInstanceOf(Date);
    expect(second.memory.retractedAt).toEqual(first.memory.retractedAt);
    expect(second.derivedRevision).toBe(first.derivedRevision);
    expect(await db.entry.count()).toBe(2);
    expect(await db.memoryEntity.count({ where: { memoryId: "m1" } })).toBe(2);
    await expect(correctMemory("m1", { expectedRevision: 1, content: "不允许复活" })).rejects.toMatchObject({ status: 409 });
  });

  it("rejects withdrawal of a newer revision and reports missing memories", async () => {
    await correctMemory("m1", { expectedRevision: 0, importance: 6 });
    await expect(retractMemory("m1", { expectedRevision: 0 })).rejects.toMatchObject({ status: 409 });
    await expect(retractMemory("missing")).rejects.toMatchObject({ status: 404 });
    await expect(correctMemory("missing", { expectedRevision: 0, content: "不存在" })).rejects.toMatchObject({ status: 404 });
  });

  it("does not overwrite a withdrawal committed while an embedding call is in flight", async () => {
    vi.mocked(embed).mockImplementationOnce(async (texts) => {
      await retractMemory("m1");
      return texts.map(embedLite);
    });
    await expect(correctMemory("m1", { expectedRevision: 0, content: "不能覆盖撤回" })).rejects.toMatchObject({ status: 409 });
    expect(await db.memory.findUnique({ where: { id: "m1" } })).toMatchObject({ status: "retracted", revision: 1, content: "需要撤回的独有记忆秘密" });
  });

  it("leaves data intact on embedding or invalidation failure", async () => {
    vi.mocked(embed).mockRejectedValueOnce(new Error("offline"));
    await expect(correctMemory("m1", { expectedRevision: 0, content: "向量失败" })).rejects.toThrow("offline");
    await db.setting.update({ where: { key: DERIVED_REVISION_KEY }, data: { value: "broken" } });
    await expect(correctMemory("m1", { expectedRevision: 0, content: "应整体回滚", entities: [] })).rejects.toThrow("Invalid memory derived revision");
    expect(await db.memory.findUnique({ where: { id: "m1" } })).toMatchObject({ revision: 0, content: "需要撤回的独有记忆秘密" });
    expect(await db.memoryEntity.count({ where: { memoryId: "m1" } })).toBe(2);
    expect(await db.monthlyRecap.count()).toBe(1);
  });

  it("counts only active links in the graph while retaining shared entities", async () => {
    await retractMemory("m1");
    const memories = await db.memory.findMany({ include: { entities: { include: { entity: true } } } });
    const graph = buildMemoryGraph("你", memories);
    expect(graph.nodes.map((n) => n.name).sort()).toEqual(["你", "西湖", "阿哲"].sort());
    expect(graph.links.find((l) => l.source === "me" && l.target === "person")?.value).toBe(1);
    expect(graph.nodes.some((n) => n.id === "old-place")).toBe(false);
  });
});

describe("profile generation revisions", () => {
  it("does not invalidate a rebuilt profile on repeated withdrawal", async () => {
    await retractMemory("m1");
    await refreshProfile();
    const repeated = await retractMemory("m1");
    expect(repeated).toMatchObject({ derivedRevision: 1, profilePending: false });
    expect((await getProfile()).isStale).toBe(false);
  });
  it("hides stale summaries, traits and style immediately after correction", async () => {
    await correctMemory("m1", { expectedRevision: 0, content: "已经更正的内容" });
    expect(await getProfile()).toMatchObject({ summary: "", traitsList: [], styleData: null, isStale: true });
  });

  it("rebuilds from active facts without feeding the previous profile or withdrawn writing samples", async () => {
    await retractMemory("m1");
    await refreshProfile();
    const messages = JSON.stringify(vi.mocked(chatJson).mock.calls[0][1]);
    expect(messages).toContain("和阿哲在西湖散步");
    expect(messages).not.toContain("独有记忆秘密");
    expect(messages).not.toContain("旧画像中的独有秘密");
    const profile = await getProfile();
    expect(profile.isStale).toBe(false);
    expect(JSON.stringify(profile.styleData)).not.toContain("旧原文秘密");
  });

  it("discards a profile generated before a user withdrawal", async () => {
    vi.mocked(chatJson).mockImplementationOnce(async (_schema, _messages, opts) => {
      await retractMemory("m1");
      return opts.mock();
    });
    await expect(refreshProfile()).rejects.toThrow("记忆已发生变化");
    expect(await getProfile()).toMatchObject({ isStale: true, summary: "" });
    expect(await db.profile.findUnique({ where: { id: "me" } })).toMatchObject({ summary: "旧画像中的独有秘密" });
  });

  it("keeps an invalidated profile stale when the model fails", async () => {
    await retractMemory("m1");
    vi.mocked(chatJson).mockRejectedValueOnce(new Error("model failed"));
    await expect(refreshProfile()).rejects.toThrow("model failed");
    expect((await getProfile()).isStale).toBe(true);
  });

  it("handles zero active memories without inventing a profile or making a model call", async () => {
    await retractMemory("m1");
    await retractMemory("m2");
    await refreshProfile();
    expect(chatJson).not.toHaveBeenCalled();
    expect(await getProfile()).toMatchObject({ isStale: false, traitsList: [] });
  });
});

describe("monthly recap revisions", () => {
  it("rejects legacy caches and generates highlights only from active memories", async () => {
    expect(await getCachedRecap("2026-10")).toBeNull();
    await retractMemory("m1");
    const recap = await buildRecap("2026-10");
    expect(recap?.highlights.map((h) => h.memoryId)).toEqual(["m2"]);
    expect(JSON.stringify(vi.mocked(chatJson).mock.calls[0][1])).not.toContain("独有记忆秘密");
    expect(await getCachedRecap("2026-10")).toEqual(recap);
    await buildRecap("2026-10");
    expect(chatJson).toHaveBeenCalledTimes(1);
  });

  it("does not resurrect a cache invalidated while generation was in flight", async () => {
    vi.mocked(chatJson).mockImplementationOnce(async (_schema, _messages, opts) => {
      await retractMemory("m1");
      return opts.mock();
    });
    await expect(buildRecap("2026-10", true)).rejects.toThrow("记忆已发生变化");
    expect(await db.monthlyRecap.count()).toBe(0);
    expect(await getCachedRecap("2026-10")).toBeNull();
  });

  it("supports empty months and rejects invalid month values", async () => {
    expect(await buildRecap("2026-09")).toBeNull();
    await expect(buildRecap("2026-13")).rejects.toThrow("无效的月份");
  });
});

describe("HTTP compatibility and errors", () => {
  it("accepts the existing bodyless DELETE and never exposes vectors", async () => {
    const response = await DELETE(new Request("http://localhost/api/memories/m1", { method: "DELETE" }), params);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ ok: true, memory: { status: "retracted", revision: 1 } });
    expect(result.memory).not.toHaveProperty("embedding");
  });

  it("returns 400 for malformed JSON and 409 for stale editors", async () => {
    const malformed = await PATCH(new Request("http://localhost/api/memories/m1", { method: "PATCH", body: "{" }), params);
    expect(malformed.status).toBe(400);
    const conflict = await PATCH(new Request("http://localhost/api/memories/m1", { method: "PATCH", body: JSON.stringify({ expectedRevision: 3, content: "过期修改" }) }), params);
    expect(conflict.status).toBe(409);
  });

  it("returns an actionable 409 when a profile was generated from old memories", async () => {
    vi.mocked(chatJson).mockImplementationOnce(async (_schema, _messages, opts) => {
      await retractMemory("m1");
      return opts.mock();
    });
    const response = await refreshProfileRoute();
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("重新生成");
  });
});

describe("withdrawn memories stay out of downstream features", () => {
  it("retrieval and the postman snapshot skip withdrawn memories", async () => {
    const { retrieve } = await import("@/lib/memory/retrieve");
    const { buildSnapshot } = await import("@/lib/postman/engine");
    const query = { query: "需要撤回的独有记忆秘密", now: date, k: 5, touch: false };
    expect((await retrieve(query)).map((m) => m.id)).toContain("m1");
    await retractMemory("m1");
    expect((await retrieve(query)).map((m) => m.id)).not.toContain("m1");
    const snapshot = await buildSnapshot(date);
    expect(snapshot.memories.map((m) => m.id)).toEqual(["m2"]);
    expect(snapshot.entityFreq.find((e) => e.name === "旧地点")?.count ?? 0).toBe(0);
  });

  it("recap statistics drop an entry whose memories were all withdrawn", async () => {
    await retractMemory("m1");
    const recap = await buildRecap("2026-10", true);
    expect(recap?.stats.count).toBe(1);
  });

  it("an empty importance field gets a Chinese validation message", async () => {
    const response = await PATCH(new Request("http://localhost/api/memories/m1", { method: "PATCH", body: JSON.stringify({ expectedRevision: 0, importance: 0 }) }), params);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("重要度最低为 1");
  });
});

describe("profile freshness without a build record", () => {
  it("a never-invalidated profile (fresh install, old data, demo) stays usable", async () => {
    await db.setting.deleteMany();
    expect(await getProfile()).toMatchObject({ isStale: false, summary: "旧画像中的独有秘密" });
  });
  it("once anything is invalidated, a missing build record means stale", async () => {
    await db.setting.deleteMany({ where: { key: PROFILE_REVISION_KEY } });
    await retractMemory("m1");
    expect((await getProfile()).isStale).toBe(true);
  });
});

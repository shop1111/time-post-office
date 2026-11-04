import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { testDatabase } from "./helpers/database";
import { db } from "@/lib/db";
import { writeLetter } from "@/lib/postman/writer";
import { writtenDayEnd } from "@/lib/postman/history";
const f = vi.hoisted(() => ({ fixture: undefined as unknown as ReturnType<typeof testDatabase> }));
vi.mock("@/lib/db", async () => {
  const { testDatabase } = await import("./helpers/database"); f.fixture = testDatabase("letter-history");
  return { db: f.fixture.db, parseJson: <T>(text: string, fallback: T): T => { try { return JSON.parse(text); } catch { return fallback; } } };
});
beforeAll(() => f.fixture.setup(), 120_000);
beforeEach(async () => {
  vi.stubEnv("CHAT_API_KEY", "test-only-placeholder"); vi.stubEnv("CHAT_BASE_URL", "https://compatible.example/v1"); vi.stubEnv("CHAT_MODEL", "test-model");
  vi.stubEnv("EMBED_MODE", "lite"); vi.stubEnv("POSTMAN_DEBUG_FAIL", "");
  await db.$transaction([db.letter.deleteMany(), db.entry.deleteMany(), db.profile.deleteMany()]);
});
afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); await f.fixture.cleanup(); });
it("所有写信输入截止本地落款日结束，过滤未来锚点、检索、画像、样本及候选文字", async () => {
  const writtenAt = new Date(2026, 7, 9, 9);
  const tonight = new Date(2026, 7, 9, 23, 59, 59);
  const nextDay = new Date(2026, 7, 10, 0, 0, 0);
  const sentinel = "未来同事阿星和月球项目";
  const old = await db.entry.create({ data: { type: "text", occurredAt: tonight, text: "那天的西湖真的好美呀！", messages: { create: [
    { role: "user", content: "当时的小鹿陪我散步呀！", createdAt: tonight },
    { role: "user", content: sentinel, createdAt: nextDay },
  ] } } });
  const future = await db.entry.create({ data: { type: "text", occurredAt: nextDay, text: sentinel, transcript: sentinel } });
  const memory = await db.memory.create({ data: { entryId: old.id, kind: "event", content: "我和小鹿一起沿着西湖散步，看到了落日。", occurredAt: tonight, importance: 9 } });
  const futureMemory = await db.memory.create({ data: { entryId: future.id, kind: "event", content: sentinel, occurredAt: nextDay, importance: 10 } });
  const inconsistent = await db.memory.create({ data: { entryId: future.id, kind: "event", content: sentinel, occurredAt: writtenAt, importance: 10 } });
  await db.profile.create({ data: { id: "me", name: sentinel, summary: sentinel, style: JSON.stringify({ samples: [sentinel] }) } });
  const inputs: string[] = [];
  let n = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    inputs.push(String(init.body));
    const value = ++n === 1 ? { subject: "西湖", body: "我和小鹿一起沿着西湖散步，看到了落日。".repeat(4), cited: [memory.id, futureMemory.id, inconsistent.id] } : { ok: true, issues: [] };
    return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
  }));
  const letter = await writeLetter({ key: "history", type: "anniversary", sender: "past_self", priority: 10, reason: sentinel, query: sentinel, entities: [sentinel], writtenAt, anchorMemoryIds: [memory.id, futureMemory.id, inconsistent.id] }, nextDay);
  expect(inputs).toHaveLength(2);
  expect(inputs.join("\n")).not.toContain(sentinel);
  expect(inputs[0]).toContain("小鹿"); expect(inputs[0]).toContain("西湖");
  expect(JSON.parse(letter.citedMemoryIds)).toEqual([memory.id]);
  expect(letter.reason).toBe(sentinel); // 展示用触发说明保留，不能送进过去的写信输入。
  expect(writtenDayEnd(writtenAt).getTime()).toBe(nextDay.getTime());
});
it("没有合格历史记忆时使用空上下文，不能回退到当前画像", async () => {
  vi.stubEnv("CHAT_API_KEY", "");
  const writtenAt = new Date(2026, 0, 1);
  await db.profile.create({ data: { id: "me", name: "未来名字", summary: "未来工作", style: "{}" } });
  const letter = await writeLetter({ key: "empty", type: "anniversary", sender: "past_self", priority: 1, reason: "未来事件", query: "未来工作", entities: [], writtenAt, anchorMemoryIds: [] }, new Date(2026, 1, 1));
  expect(letter.body).not.toMatch(/未来名字|未来工作|未来事件/);
  expect(JSON.parse(letter.citedMemoryIds)).toEqual([]);
});

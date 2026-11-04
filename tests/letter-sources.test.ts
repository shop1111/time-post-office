import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { testDatabase } from "./helpers/database";
import { db } from "@/lib/db";
import { GET } from "@/app/api/letters/[id]/sources/route";
import { letterSources, splitLetterBody } from "@/lib/letters/sources";
import { writeLetter } from "@/lib/postman/writer";
const f = vi.hoisted(() => ({ fixture: undefined as unknown as ReturnType<typeof testDatabase> }));
vi.mock("@/lib/db", async () => {
  const { testDatabase } = await import("./helpers/database"); f.fixture = testDatabase("letter-sources");
  return { db: f.fixture.db, parseJson: <T>(text: string | null, fallback: T): T => { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } } };
});
const content = "去年秋天我和小林沿着杭州西湖散步，看到了金色落日。";
const date = new Date("2026-08-09T10:00:00.000Z");
beforeAll(() => f.fixture.setup(), 120_000);
beforeEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  vi.stubEnv("CHAT_API_KEY", ""); vi.stubEnv("EMBED_MODE", "lite"); vi.stubEnv("POSTMAN_DEBUG_FAIL", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.$transaction([db.letter.deleteMany(), db.entry.deleteMany(), db.memory.deleteMany(), db.entity.deleteMany(), db.profile.deleteMany()]);
});
afterAll(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); await f.fixture.cleanup(); });
const memory = () => db.memory.create({ data: { kind: "event", content, occurredAt: date, importance: 8 } });
const createLetter = (body: string, citedSnapshot = "[]", citedMemoryIds = "[]") => db.letter.create({ data: { sender: "postman", subject: "日落", body, triggerType: "manual", scheduledAt: date, deliveredAt: date, citedSnapshot, citedMemoryIds } });
const snapshot = (id: string) => ({ memoryId: id, entryId: null, content, occurredAt: date.toISOString() });
it.each(["", " 你好。\n\n西湖！🙂 再见。  ", "“日落很美。”\r\n他说：嗯……", "Hello! 3.14 is pi.\n末尾没有标点🙂"])("分句无损拼回正文：%s", (body) => {
  expect(splitLetterBody(body).join("")).toBe(body);
});
it("端点excerpt来自快照；更正后仍返回原文，删除后标为撤回且不再返回原文", async () => {
  const mem = await memory();
  const body = ` 亲爱的你：\n${content}\n\n火星上有一座巨大的玻璃城堡。🙂`;
  const letter = await createLetter(body, JSON.stringify([snapshot(mem.id)]), JSON.stringify([mem.id]));
  const get = async () => (await GET(new Request("http://test/sources"), { params: Promise.resolve({ id: letter.id }) })).json();
  const first = await get();
  expect(first.sentences.map((sentence: { text: string }) => sentence.text).join("")).toBe(body);
  expect(first.sentences.flatMap((sentence: { sources: unknown[] }) => sentence.sources)).toContainEqual({ memoryId: mem.id, entryId: null, date: date.toISOString(), excerpt: content, state: "current" });
  expect(first.sentences.find((sentence: { text: string }) => sentence.text.includes("火星")).sources).toEqual([]);
  await db.memory.update({ where: { id: mem.id }, data: { content: "后来纠正为和妈妈去了北海" } });
  const corrected = (await get()).sentences.flatMap((sentence: { sources: unknown[] }) => sentence.sources);
  expect(corrected).toContainEqual(expect.objectContaining({ excerpt: content, state: "corrected" }));
  await db.memory.delete({ where: { id: mem.id } });
  const withdrawn = (await get()).sentences.flatMap((sentence: { sources: unknown[] }) => sentence.sources);
  expect(withdrawn).toContainEqual(expect.objectContaining({ excerpt: "", state: "withdrawn" }));
});
it("记忆被用户撤回（软撤回）后，出处标为撤回且不再返回原文", async () => {
  const mem = await memory();
  const letter = await createLetter(content, JSON.stringify([snapshot(mem.id)]), JSON.stringify([mem.id]));
  await db.memory.update({ where: { id: mem.id }, data: { status: "retracted", retractedAt: date } });
  expect((await letterSources(letter.id))!.sentences[0].sources).toEqual([expect.objectContaining({ memoryId: mem.id, excerpt: "", state: "withdrawn" })]);
});
it("每句至多两个出处，不匹配就空数组，祝福不牵强绑定", async () => {
  const snapshots = ["a", "b", "c"].map(snapshot);
  const letter = await createLetter(content + "祝你幸福快乐。", JSON.stringify(snapshots));
  const result = await letterSources(letter.id);
  expect(result!.sentences[0].sources).toHaveLength(2);
  expect(result!.sentences[1].sources).toEqual([]);
});
it("旧信无快照时读取当前引用，已不存在的旧引用不编造原文", async () => {
  const mem = await memory();
  const letter = await createLetter(content, "[]", JSON.stringify([mem.id, "deleted-before-snapshot"]));
  expect((await letterSources(letter.id))!.sentences[0].sources).toEqual([{ memoryId: mem.id, entryId: null, date: date.toISOString(), excerpt: content, state: "current" }]);
});
it("损坏快照不误当旧数据；缺失信件返回404", async () => {
  const mem = await memory();
  const letter = await createLetter(content, "not json", JSON.stringify([mem.id]));
  expect((await letterSources(letter.id))!.sentences[0].sources).toEqual([]);
  expect((await GET(new Request("http://test/sources"), { params: Promise.resolve({ id: "missing" }) })).status).toBe(404);
});
it.each(["unchecked", "passed", "rewritten", "failed"] as const)("写信落库状态%s及原文快照：原文不是模型返回的摘录", async (status) => {
  const mem = await memory();
  const revised = content + "愿你记住那个温暖的傍晚。";
  if (status !== "unchecked") {
    vi.stubEnv("CHAT_API_KEY", "test-only-placeholder"); vi.stubEnv("CHAT_MODEL", "test-model"); vi.stubEnv("CHAT_BASE_URL", "https://compatible.example/v1");
    const outputs: unknown[] = [{ subject: "日落", body: content.repeat(3), cited: [mem.id, "invented"], excerpt: "模型编造的原文" },
      status === "passed" ? { ok: true, issues: [] } : { ok: false, issues: ["一处问题"] }, revised, { ok: status === "rewritten", issues: status === "failed" ? ["仍有问题"] : [] }];
    vi.stubGlobal("fetch", async () => { const value = outputs.shift(); return Response.json({ choices: [{ message: { content: typeof value === "string" ? value : JSON.stringify(value) } }] }); });
  }
  const letter = await writeLetter({ key: "source-write", type: "anniversary", sender: "postman", priority: 10, reason: "回顾西湖", writtenAt: date, anchorMemoryIds: [mem.id], query: "西湖", entities: [] }, new Date());
  expect(letter.checkStatus).toBe(status);
  expect(letter.reason).toBe("回顾西湖");
  expect(JSON.parse(letter.citedSnapshot)).toEqual([snapshot(mem.id)]);
  expect(JSON.parse(letter.citedMemoryIds)).toEqual([mem.id]);
  if (status === "rewritten" || status === "failed") expect(letter.body).toBe(revised);
});
it("生成期间引用记忆正文已更正，即使未更新版本号也不投递", async () => {
  const mem = await memory();
  vi.stubEnv("CHAT_API_KEY", "test-only-placeholder"); vi.stubEnv("CHAT_MODEL", "test-model"); vi.stubEnv("CHAT_BASE_URL", "https://compatible.example/v1");
  let call = 0;
  vi.stubGlobal("fetch", async () => {
    const value = ++call === 1 ? { subject: "日落", body: content.repeat(3), cited: [mem.id] } : { ok: true, issues: [] };
    if (call === 2) await db.memory.update({ where: { id: mem.id }, data: { content: "更正后的新原文" } });
    return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
  });
  await expect(writeLetter({ key: "race", type: "anniversary", sender: "postman", priority: 1, reason: "回顾", writtenAt: date, anchorMemoryIds: [mem.id], query: "西湖", entities: [] }, new Date()))
    .rejects.toMatchObject({ code: "POSTMAN_CONTEXT_CHANGED", retryable: true });
  expect(await db.letter.count()).toBe(0);
});

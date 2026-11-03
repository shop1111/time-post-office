import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { testDatabase } from "./helpers/database";
import { db } from "@/lib/db";
import { buildSnapshot, tick } from "@/lib/postman/engine";
import { writeLetter } from "@/lib/postman/writer";
import { collectCandidates, milestoneTriggers, type LetterCandidate } from "@/lib/postman/triggers";
import type { PostmanDecision, PostmanStageEvent, TriggerType } from "@/lib/types";

const f = vi.hoisted(() => ({ fixture: undefined as unknown as ReturnType<typeof testDatabase> }));
vi.mock("@/lib/db", async () => {
  const { testDatabase } = await import("./helpers/database");
  f.fixture = testDatabase("postman");
  return { db: f.fixture.db, parseJson: <T>(text: string | null, fallback: T): T => { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } } };
});
vi.mock("@/lib/postman/triggers", async (original) => {
  const actual = await original<typeof import("@/lib/postman/triggers")>();
  return { ...actual, collectCandidates: vi.fn(actual.collectCandidates) };
});
vi.mock("@/lib/postman/writer", async (original) => {
  const actual = await original<typeof import("@/lib/postman/writer")>();
  return { ...actual, writeLetter: vi.fn(actual.writeLetter) };
});
const realWrite = vi.mocked(writeLetter).getMockImplementation()!;
const realCollect = vi.mocked(collectCandidates).getMockImplementation()!;
const NOW = new Date("2026-11-03T12:00:00Z");
const candidate = (key: string, type: TriggerType, priority = 10): LetterCandidate => ({ key, type, priority, sender: "postman", reason: "测试候选", writtenAt: NOW, anchorMemoryIds: [], query: "回忆", entities: [] });
const existing = (key: string, deliveredAt: Date | null = NOW, sender = "postman") => db.letter.create({ data: { triggerKey: key, sender, subject: key, body: "已有信", triggerType: "manual", writtenAt: NOW, scheduledAt: NOW, deliveredAt } });
beforeAll(() => f.fixture.setup(), 30_000);
beforeEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals();
  vi.mocked(writeLetter).mockReset().mockImplementation(realWrite);
  vi.mocked(collectCandidates).mockReset().mockImplementation(realCollect);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("CHAT_API_KEY", ""); vi.stubEnv("EMBED_MODE", "lite"); vi.stubEnv("POSTMAN_DEBUG_FAIL", "");
  await db.$transaction([db.letter.deleteMany(), db.entry.deleteMany(), db.entity.deleteMany(), db.profile.deleteMany(), db.setting.deleteMany()]);
});
afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); await f.fixture.cleanup(); });

describe("postman actual decisions", () => {
  it("所有候选在同一执行分支得到去向，保留前8项和完整排名", async () => {
    const old = await existing("old");
    const candidates = [candidate("old", "anniversary", 100), candidate("loop1", "open_loop", 90), candidate("loop2", "open_loop", 80), candidate("person", "milestone", 70), ...Array.from({ length: 6 }, (_, i) => candidate(`anniv${i}`, "anniversary", 60 - i))];
    vi.mocked(collectCandidates).mockReturnValue(candidates);
    const events: PostmanDecision[] = [];
    const result = await tick({ now: NOW, ignoreGap: true, maxLetters: 2, onDecision: (d) => events.push(d) });
    expect(result.decisions.map((d) => d.outcome)).toEqual(["deduplicated", "generated", "type_limited", "generated", ...Array(6).fill("quota_limited")]);
    expect(result.decisions[0].existingLetterId).toBe(old.id);
    expect(result.decisions.map((d) => d.rank)).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    expect(result.candidates).toHaveLength(8); expect(result.totalCandidates).toBe(10);
    expect(events.filter((d) => d.key === "loop1").map((d) => d.outcome)).toEqual(["selected", "generated"]);
    expect(writeLetter).toHaveBeenCalledTimes(2);
    const phases = result.decisions[1].stages;
    expect(phases.map((s) => [s.name, s.status])).toEqual([["retrieve", "completed"], ["generate", "completed"], ["check", "skipped"], ["deliver", "completed"]]);
    expect(phases[1].execution?.mode).toBe("mock");
    expect(phases.every((s) => typeof s.durationMs === "number" && s.durationMs >= 0)).toBe(true);
    expect(result.generated).toHaveLength(2);
  });
  it("去重优先于20小时频控，ignoreGap时不产生rate_limited", async () => {
    await existing("sent", new Date(NOW.getTime() - 19 * 3_600_000));
    vi.mocked(collectCandidates).mockReturnValue([candidate("sent", "anniversary"), candidate("new", "open_loop")]);
    expect((await tick({ now: NOW })).decisions.map((d) => d.outcome)).toEqual(["deduplicated", "rate_limited"]);
    expect(writeLetter).not.toHaveBeenCalled();
    expect((await tick({ now: NOW, ignoreGap: true })).decisions[1].outcome).toBe("generated");
  });
  it("恰满20小时可寄信，reset后未来投递日期不阻挡今天", async () => {
    await existing("future", new Date(NOW.getTime() + 7 * 86_400_000));
    await existing("past", new Date(NOW.getTime() - 20 * 3_600_000));
    vi.mocked(collectCandidates).mockReturnValue([candidate("new", "open_loop")]);
    expect((await tick({ now: NOW })).decisions[0].outcome).toBe("generated");
  });
  it("到期胶囊进入delivered，与本轮generated不重叠", async () => {
    const capsule = await existing("capsule", null, "user");
    vi.mocked(collectCandidates).mockReturnValue([candidate("new", "open_loop")]);
    const result = await tick({ now: NOW });
    expect(result.delivered).toEqual([capsule.id]);
    expect(result.generated).toHaveLength(1);
    expect(result.generated).not.toContain(capsule.id);
  });
  it("单封generate失败占名额，不补位，其他已选类型照常投递", async () => {
    vi.stubEnv("POSTMAN_DEBUG_FAIL", "open_loop");
    vi.mocked(collectCandidates).mockReturnValue([candidate("bad", "open_loop"), candidate("good", "anniversary"), candidate("extra", "milestone")]);
    const events: PostmanStageEvent[] = [];
    const result = await tick({ now: NOW, maxLetters: 2, onStage: (s) => events.push(s) });
    expect(result.decisions.map((d) => d.outcome)).toEqual(["failed", "generated", "quota_limited"]);
    expect(result.decisions[0].error).toMatchObject({ code: "POSTMAN_GENERATE_FAILED", retryable: true });
    expect(events.filter((s) => s.key === "bad" && s.status !== "started").map((s) => [s.name, s.status])).toEqual([["retrieve", "completed"], ["generate", "failed"], ["check", "skipped"], ["deliver", "skipped"]]);
    expect(await db.letter.count()).toBe(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("PostmanDebugFailure: Intentional"));
  });
  it("production下故障环境变量无效", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("POSTMAN_DEBUG_FAIL", "open_loop");
    vi.mocked(collectCandidates).mockReturnValue([candidate("normal", "open_loop")]);
    expect((await tick({ now: NOW })).decisions[0].outcome).toBe("generated");
  });
  it("快照后发生真实唯一键冲突，返回去重及已有ID且不终止其他信", async () => {
    let oldId = "";
    vi.mocked(collectCandidates).mockReturnValue([candidate("raced", "open_loop"), candidate("normal", "anniversary")]);
    vi.mocked(writeLetter).mockImplementationOnce(async (...args) => { oldId = (await existing("raced")).id; return realWrite(...args); });
    const result = await tick({ now: NOW, maxLetters: 2 });
    expect(result.decisions[0]).toMatchObject({ outcome: "deduplicated", existingLetterId: oldId });
    expect(result.decisions[0].stages.at(-1)).toMatchObject({ name: "deliver", status: "skipped" });
    expect(result.decisions[1].outcome).toBe("generated");
    expect(await db.letter.count({ where: { triggerKey: "raced" } })).toBe(1);
    expect(result.generated).not.toContain(oldId);
  });
  it("直接并发tick也串行，候选第二次看到去重且只调用一次写信", async () => {
    vi.mocked(collectCandidates).mockReturnValue([candidate("same", "open_loop")]);
    const [a, b] = await Promise.all([tick({ now: NOW, ignoreGap: true }), tick({ now: NOW, ignoreGap: true })]);
    expect(a.decisions[0].outcome).toBe("generated"); expect(b.decisions[0].outcome).toBe("deduplicated");
    expect(writeLetter).toHaveBeenCalledTimes(1);
  });
  it("人物计数按不同Entry，同篇3条记忆只算1次，孤立/未来记忆不算", async () => {
    const person = await db.entity.create({ data: { name: "小林", type: "person" } });
    const add = async (id: string | null) => db.memory.create({ data: { entryId: id, kind: "event", content: "和小林散步", occurredAt: NOW, entities: { create: [{ entityId: person.id }] } } });
    const first = await db.entry.create({ data: { type: "text", occurredAt: NOW } });
    for (let i = 0; i < 3; i++) await add(first.id);
    await add(null);
    const future = await db.entry.create({ data: { type: "text", occurredAt: new Date(NOW.getTime() + 86_400_000) } }); await add(future.id);
    expect((await buildSnapshot(NOW)).entityFreq[0].count).toBe(1);
    for (let i = 0; i < 3; i++) await add((await db.entry.create({ data: { type: "text", occurredAt: NOW } })).id);
    const snapshot = await buildSnapshot(NOW);
    expect(snapshot.entityFreq[0].count).toBe(4);
    expect(milestoneTriggers(snapshot).find((c) => c.key === "person:小林")?.reason).toContain("4 段记录");
  });
  it.each([true, false])("真实调用核查正常=%s，按execution区分completed与failed", async (success) => {
    vi.stubEnv("CHAT_API_KEY", "test-only-placeholder"); vi.stubEnv("CHAT_MODEL", "test-model"); vi.stubEnv("CHAT_BASE_URL", "https://compatible.example/v1");
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (++n === 2 && !success) return new Response(null, { status: 401 });
      const value = n === 1 ? { subject: "来信", body: "有过的日子会陪着你。".repeat(10), cited: [] } : { ok: true, issues: [] };
      return Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
    }));
    vi.mocked(collectCandidates).mockReturnValue([candidate("remote", "open_loop")]);
    const result = await tick({ now: NOW });
    const check = result.decisions[0].stages.find((s) => s.name === "check");
    expect(check).toMatchObject({ status: success ? "completed" : "failed", execution: { mode: success ? "remote" : "fallback" } });
    expect(result.decisions[0].outcome).toBe("generated");
    // M3字段暂不实现，数据库默认保持unchecked。
    expect((await db.letter.findFirstOrThrow()).checkStatus).toBe("unchecked");
  });
});

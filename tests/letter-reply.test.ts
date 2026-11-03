import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { testDatabase } from "./helpers/database";
import { db } from "@/lib/db";
import { POST } from "@/app/api/letters/[id]/route";
import { getFinalizeStatus, startFinalize } from "@/lib/jobs";
import { extractEntry } from "@/lib/memory/extract";
const f = vi.hoisted(() => ({ fixture: undefined as unknown as ReturnType<typeof testDatabase> }));
vi.mock("@/lib/db", async () => {
  const { testDatabase } = await import("./helpers/database"); f.fixture = testDatabase("letter-reply");
  return { db: f.fixture.db, parseJson: <T>(text: string | null, fallback: T): T => { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } } };
});
vi.mock("@/lib/memory/extract", async (original) => {
  const actual = await original<typeof import("@/lib/memory/extract")>();
  return { ...actual, extractEntry: vi.fn(actual.extractEntry) };
});
const realExtract = vi.mocked(extractEntry).getMockImplementation()!;
beforeAll(() => f.fixture.setup(), 30_000);
beforeEach(async () => {
  vi.restoreAllMocks(); vi.stubEnv("CHAT_API_KEY", ""); vi.stubEnv("EMBED_MODE", "lite");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(extractEntry).mockReset().mockImplementation(realExtract);
  await db.$transaction([db.job.deleteMany(), db.letter.deleteMany(), db.entry.deleteMany(), db.memory.deleteMany(), db.entity.deleteMany(), db.profile.deleteMany()]);
});
afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await f.fixture.cleanup(); });
const reply = (id: string, text: string) => POST(new Request("http://test/letter", { method: "POST", body: JSON.stringify({ action: "reply", reply: text }) }), { params: Promise.resolve({ id }) });
async function setup() {
  const plans = await Promise.all(["准备摄影考试", "下周工作面试"].map((content) => db.memory.create({ data: { content, kind: "plan", occurredAt: new Date() } })));
  const letter = await db.letter.create({ data: { sender: "past_self", subject: "结果怎么样", body: "那件事后来怎么样了", triggerType: "open_loop", triggerKey: `loop:${plans[0].id}`, citedMemoryIds: JSON.stringify(plans.map((plan) => plan.id)), scheduledAt: new Date(), deliveredAt: new Date() } });
  return { plans, letter };
}
async function settled(id: string) {
  await vi.waitFor(async () => expect(["completed", "partial", "failed"]).toContain((await getFinalizeStatus(id)).status));
  return getFinalizeStatus(id);
}
it("回信不关闭未做计划；完成回复只关闭真正被问的目标，任务含故事卡片", async () => {
  const { plans, letter } = await setup();
  const pending = await (await reply(letter.id, "还没考，推迟到下个月")).json();
  expect(pending.resolvedPlanIds).toEqual([]);
  expect((await db.memory.findUniqueOrThrow({ where: { id: plans[0].id } })).resolved).toBe(false);
  await settled(pending.replyEntryId);
  const done = await (await reply(letter.id, "考完了，过了！")).json();
  expect(done.letter.reply).toBe("考完了，过了！");
  expect(done.resolvedPlanIds).toEqual([plans[0].id]);
  expect((await db.memory.findUniqueOrThrow({ where: { id: plans[1].id } })).resolved).toBe(false);
  const state = await settled(done.replyEntryId);
  expect(state.jobId).toBe(done.jobId);
  expect(state.result?.card).not.toBeNull();
  expect(state.result?.memories.length).toBeGreaterThan(0);
});
it("Job插入失败时回滚信件更新、关闭计划和回信记录", async () => {
  const { plans, letter } = await setup();
  await db.$executeRawUnsafe('CREATE TRIGGER reject_reply_job BEFORE INSERT ON "Job" BEGIN SELECT RAISE(ABORT, \'test job failure\'); END');
  try {
    expect((await reply(letter.id, "考完了，过了！")).status).toBe(500);
    expect((await db.letter.findUniqueOrThrow({ where: { id: letter.id } })).reply).toBeNull();
    expect((await db.memory.findUniqueOrThrow({ where: { id: plans[0].id } })).resolved).toBe(false);
    expect(await db.entry.count()).toBe(0);
    expect(await db.job.count()).toBe(0);
  } finally { await db.$executeRawUnsafe('DROP TRIGGER reject_reply_job'); }
});
it("抽取失败有持久任务状态，可从同一回信记录重试", async () => {
  const { letter } = await setup();
  vi.mocked(extractEntry).mockRejectedValueOnce(new Error("temporary extraction failure"));
  const response = await reply(letter.id, "还没考，推迟到下个月");
  expect(response.status).toBe(200);
  const saved = await response.json();
  const failed = await settled(saved.replyEntryId);
  expect(failed.status).toBe("failed"); expect(failed.error?.stage).toBe("extract");
  expect((await db.letter.findUniqueOrThrow({ where: { id: letter.id } })).reply).toBeTruthy();
  const { run } = await startFinalize(saved.replyEntryId); await run.done;
  expect((await getFinalizeStatus(saved.replyEntryId)).status).toBe("completed");
  expect(await db.entry.count()).toBe(1); expect(await db.job.count()).toBe(1);
});

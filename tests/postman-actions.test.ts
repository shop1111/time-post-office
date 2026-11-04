import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { testDatabase } from "./helpers/database";
import { db } from "@/lib/db";
import { POST } from "@/app/api/postman/route";
import { runPostmanAction } from "@/lib/postman/actions";
import { tickWithinAction } from "@/lib/postman/engine";
import { getOffset, MS_DAY } from "@/lib/clock";
import type { PostmanMetaEvent, PostmanResult } from "@/lib/types";

const f = vi.hoisted(() => ({ fixture: undefined as unknown as ReturnType<typeof testDatabase> }));
vi.mock("@/lib/db", async () => {
  const { testDatabase } = await import("./helpers/database");
  f.fixture = testDatabase("postman-actions");
  return { db: f.fixture.db, parseJson: <T>(text: string | null, fallback: T): T => { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } } };
});
vi.mock("@/lib/postman/engine", async (original) => {
  const actual = await original<typeof import("@/lib/postman/engine")>();
  return { ...actual, tickWithinAction: vi.fn(actual.tickWithinAction) };
});
const realTick = vi.mocked(tickWithinAction).getMockImplementation()!;
const gate = () => { let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; }); return { wait, release }; };
const request = (body: unknown, sse = false, signal?: AbortSignal) => new Request("http://test/postman", { method: "POST", body: JSON.stringify(body), headers: sse ? { Accept: "text/event-stream" } : {}, signal });
const parse = (text: string) => text.trim().split("\n\n").map((block) => { const [event, data] = block.split("\n"); return { event: event.slice(7), data: JSON.parse(data.slice(6)) }; });
const plan = async () => {
  const occurredAt = new Date(Date.now() - 10 * MS_DAY);
  return db.entry.create({ data: { type: "text", text: "考试计划", occurredAt, memories: { create: [{ kind: "plan", content: "准备参加考试", importance: 8, occurredAt, dueAt: new Date(Date.now() - MS_DAY) }] } } });
};
beforeAll(() => f.fixture.setup(), 120_000);
beforeEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(tickWithinAction).mockReset().mockImplementation(realTick);
  vi.stubEnv("CHAT_API_KEY", ""); vi.stubEnv("EMBED_MODE", "lite"); vi.stubEnv("POSTMAN_DEBUG_FAIL", "");
  await db.$transaction([db.letter.deleteMany(), db.entry.deleteMany(), db.entity.deleteMany(), db.profile.deleteMany(), db.setting.deleteMany()]);
});
afterAll(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await f.fixture.cleanup(); });

describe("serialized postman actions and routes", () => {
  it("快进两次依次拨时钟和巡检，累计天数正确且只写一封同键信", async () => {
    await plan();
    const entered = gate(); const resume = gate();
    vi.mocked(tickWithinAction).mockImplementationOnce(async (...args) => { entered.release(); await resume.wait; return realTick(...args); });
    const metas: PostmanMetaEvent[] = [];
    const capture = (event: string, data: unknown) => { if (event === "meta") metas.push(data as PostmanMetaEvent); };
    const first = runPostmanAction({ action: "forward", days: 7 }, capture);
    await entered.wait;
    const second = runPostmanAction({ action: "forward", days: 7 }, capture);
    expect(await getOffset()).toBe(7 * MS_DAY);
    expect(metas).toHaveLength(1);
    resume.release();
    const [a, b] = await Promise.all([first, second]);
    expect(await getOffset()).toBe(14 * MS_DAY);
    expect(a.generated).toHaveLength(1); expect(b.generated).toHaveLength(0);
    expect(b.decisions[0].outcome).toBe("deduplicated");
    expect(new Date(metas[1].from).getTime()).toBeGreaterThanOrEqual(new Date(metas[0].to).getTime());
    expect(await db.letter.count()).toBe(1);
  });
  it("forward、reset、force、tick共用队列且reset返回完整兼容结果", async () => {
    const entered = gate(); const resume = gate();
    vi.mocked(tickWithinAction).mockImplementationOnce(async (...args) => { entered.release(); await resume.wait; return realTick(...args); });
    const order: string[] = [];
    const observer = (event: string, data: unknown) => { if (event === "meta") order.push((data as PostmanMetaEvent).action); };
    const forward = runPostmanAction({ action: "forward", days: 2 }, observer);
    await entered.wait;
    const reset = runPostmanAction({ action: "reset" }, observer);
    const force = runPostmanAction({ action: "force" }, observer);
    const tick = runPostmanAction({ action: "tick" }, observer);
    expect(await getOffset()).toBe(2 * MS_DAY);
    resume.release();
    const results = await Promise.all([forward, reset, force, tick]);
    expect(order).toEqual(["forward", "reset", "force", "tick"]);
    expect(results[1]).toMatchObject({ ok: true, generated: [], delivered: [], candidates: [], decisions: [], totalCandidates: 0, skippedByRateLimit: false });
    expect(await getOffset()).toBe(0);
  });
  it("SSE先selected再生成，四阶段真实事件，JSON字段齐全", async () => {
    await plan();
    const response = await POST(request({ action: "forward", days: 7 }, true));
    const events = parse(await response.text());
    expect(events.map(({ event, data }) => event === "decision" ? `decision:${data.outcome}` : event === "stage" ? `${data.name}:${data.status}` : event)).toEqual([
      "meta", "decision:selected", "retrieve:started", "retrieve:completed", "generate:started", "generate:completed", "check:skipped", "deliver:started", "deliver:completed", "decision:generated", "done",
    ]);
    const result = events.at(-1)!.data.result as PostmanResult;
    expect(result).toMatchObject({ runId: events[0].data.runId, durationMs: expect.any(Number), totalCandidates: 1, generated: [expect.any(String)] });
    const json = await (await POST(request({ action: "tick" }))).json();
    for (const field of ["now", "delivered", "generated", "candidates", "skippedByRateLimit", "runId", "durationMs", "decisions", "totalCandidates"]) expect(json).toHaveProperty(field);
    expect(json.decisions[0].outcome).toBe("deduplicated");
  });
  it("排队时断开SSE只停止推送，动作仍执行完且后续队列继续", async () => {
    await plan();
    const entered = gate(); const resume = gate();
    vi.mocked(tickWithinAction).mockImplementationOnce(async (...args) => { entered.release(); await resume.wait; return realTick(...args); });
    const first = runPostmanAction({ action: "forward", days: 1 });
    await entered.wait;
    const controller = new AbortController();
    const response = await POST(request({ action: "forward", days: 2 }, true, controller.signal));
    controller.abort(); await response.body!.cancel();
    const following = runPostmanAction({ action: "tick" });
    resume.release();
    await first; await following;
    expect(await getOffset()).toBe(3 * MS_DAY);
    expect(await db.letter.count()).toBe(1);
    expect(tickWithinAction).toHaveBeenCalledTimes(3);
  });
  it("已断连的请求也会排队，取消不能撤销已接受的动作", async () => {
    const controller = new AbortController(); controller.abort();
    const response = await POST(request({ action: "forward", days: 2 }, true, controller.signal));
    await response.text();
    await runPostmanAction({ action: "tick" });
    expect(await getOffset()).toBe(2 * MS_DAY);
  });
  it("整轮异常发SSE error且不把队列卡死，JSON异常仍是通用错误体", async () => {
    vi.mocked(tickWithinAction).mockRejectedValueOnce(new Error("snapshot unavailable"));
    const events = parse(await (await POST(request({ action: "tick" }, true))).text());
    expect(events.map((event) => event.event)).toEqual(["meta", "error"]);
    expect(events[1].data).toMatchObject({ code: "POSTMAN_FAILED", retryable: true });
    vi.mocked(tickWithinAction).mockRejectedValueOnce(new Error("snapshot unavailable"));
    const failed = await POST(request({ action: "tick" }));
    expect(failed.status).toBe(500); expect(await failed.json()).toHaveProperty("error");
    expect((await POST(request({ action: "reset" }))).status).toBe(200);
  });
});

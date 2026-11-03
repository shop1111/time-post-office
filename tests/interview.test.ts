import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/entries/[id]/interview/route";
import { ChatStreamError, type ChatOptions } from "@/lib/ai/provider";
import { DEFAULT_WEIGHTS } from "@/lib/memory/rank";

const f = vi.hoisted(() => ({ entry: vi.fn(), create: vi.fn(), stream: vi.fn(), retrieve: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  entry: { findUnique: f.entry }, entity: { findMany: async () => [{ name: "阿青", type: "person" }] },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ entryMessage: { create: f.create } }),
} }));
vi.mock("@/lib/ai/provider", async (original) => ({ ...await original<object>(), chatStream: f.stream }));
vi.mock("@/lib/memory/retrieve", async (original) => ({ ...await original<object>(), retrieve: f.retrieve }));
vi.mock("@/lib/memory/profile", () => ({ getProfile: async () => ({ summary: "" }) }));
vi.mock("@/lib/clock", () => ({ now: async () => new Date("2026-11-03") }));

const context = { params: Promise.resolve({ id: "interview-test" }) };
const request = (message?: string, signal?: AbortSignal) => new Request("http://test/interview", { method: "POST", body: JSON.stringify({ message }), signal });
const info = { mode: "mock" as const, durationMs: 1, fallbackReason: "not_configured" };
beforeEach(() => {
  vi.clearAllMocks();
  f.entry.mockResolvedValue({ id: "interview-test", type: "text", text: "今天和小林去杭州，遇见阿青很开心", occurredAt: new Date("2026-11-03"), messages: [], interviewDone: false });
  f.create.mockResolvedValue({}); f.retrieve.mockResolvedValue([]);
  f.stream.mockImplementation(async function* (_messages: unknown, opts: ChatOptions) { yield "完整追问"; opts.onExecution?.(info); });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("interview route", () => {
  it("meta权重与检索实参一致，文字识别人物地点，done携带execution", async () => {
    const text = await (await POST(request("很好"), context)).text();
    expect(text).toContain('"weights":' + JSON.stringify(DEFAULT_WEIGHTS));
    expect(f.retrieve.mock.lastCall?.[0]).toMatchObject({ weights: DEFAULT_WEIGHTS, entities: expect.arrayContaining(["小林", "杭州", "阿青"]) });
    expect(text).toContain('"execution":' + JSON.stringify(info));
    expect(f.create).toHaveBeenCalledTimes(2);
  });
  it("同记录同时追问返回409，释放后可继续", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    f.stream.mockImplementationOnce(async function* (_messages: unknown, opts: ChatOptions) { await pending; yield "完成"; opts.onExecution?.(info); });
    const first = await POST(request(), context);
    const busy = await POST(request(), context);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ code: "INTERVIEW_BUSY", retryable: true });
    finish(); await first.text();
    expect((await (await POST(request(), context)).text())).toContain("event: done");
  });
  it.each(["limit", "finalized"])("后端强制拒绝%s且不写入本轮输入", async (reason) => {
    f.entry.mockResolvedValueOnce({ messages: reason === "limit" ? Array(3).fill({ role: "assistant" }) : [], interviewDone: reason === "finalized" });
    const response = await POST(request("不能新增"), context);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INTERVIEW_LIMIT_REACHED" });
    expect(f.create).not.toHaveBeenCalled();
  });
  it("已输出后失败发结构化error，不保存残缺回答和本轮输入", async () => {
    f.stream.mockImplementationOnce(async function* () { yield "半句"; throw new ChatStreamError("timeout", true, { ...info, mode: "remote" }); });
    const text = await (await POST(request("这轮输入"), context)).text();
    expect(text).toContain('event: error\ndata: {"code":"timeout"');
    expect(text).not.toContain("event: done");
    expect(f.create).not.toHaveBeenCalled();
  });
  it("未输出时Provider降级结果能完成并如实标fallback", async () => {
    f.stream.mockImplementationOnce(async function* (_messages: unknown, opts: ChatOptions) { yield "本地兜底"; opts.onExecution?.({ ...info, mode: "fallback", fallbackReason: "http_503" }); });
    const text = await (await POST(request(), context)).text();
    expect(text).toContain('"mode":"fallback"');
    expect(text).toContain("event: done");
    expect(f.create).toHaveBeenCalledTimes(1);
  });
});

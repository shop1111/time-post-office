import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, basename, join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { beforeAll, beforeEach, afterAll, afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ db: null as unknown as PrismaClient }));
vi.mock("@/lib/db", () => ({
  get db() { return fixture.db; },
  parseJson: (text: string | null, fallback: unknown) => { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } },
}));
vi.mock("@/lib/ai/provider", async (original) => ({ ...await original<object>(), chat: vi.fn(), chatStream: vi.fn() }));
vi.mock("@/lib/memory/retrieve", async (original) => ({ ...await original<object>(), retrieve: vi.fn(async () => []) }));

import { POST } from "@/app/api/entries/[id]/interview/route";
import { chat, chatStream } from "@/lib/ai/provider";
import { beginTurn, endConversation, failTurn, finishTurn } from "@/lib/xiaoju/session";
import { PlanSchema } from "@/lib/xiaoju/policy";
import { ExtractionSchema } from "@/lib/memory/extract";
import { reflectConversation } from "@/lib/xiaoju/reflect";
import { conversationContext } from "@/lib/xiaoju/context";
import { DELETE as retractInsight } from "@/app/api/memories/insights/[id]/route";

const directory = mkdtempSync(join(tmpdir(), "xiaoju-conversation-"));
const url = `file:${join(directory, "test.db").replaceAll("\\", "/")}`;
const db = new PrismaClient({ datasources: { db: { url } } });
const plan = { act: "respond", focus: "今天的经历", explicitEmotion: [], uncertainty: [], openThreads: [], askedTopics: [], corrections: [], question: null, useMemoryIds: [], avoid: [] };
const request = (message?: string, requestId = "opening", signal?: AbortSignal) => new Request("http://test/interview", { method: "POST", body: JSON.stringify({ message, requestId }), signal });
const params = { params: Promise.resolve({ id: "capsule" }) };
async function submit(message?: string, id = "opening") { return (await POST(request(message, id), params)).text(); }

beforeAll(async () => {
  fixture.db = db;
  await db.$queryRaw`SELECT 1`;
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: url }, stdio: "pipe", timeout: 30_000,
  });
}, 40_000);
afterAll(async () => {
  await db.$disconnect();
  if (dirname(directory) === resolve(tmpdir()) && basename(directory).startsWith("xiaoju-conversation-")) rmSync(directory, { recursive: true, force: true });
});
beforeEach(async () => {
  vi.mocked(chat).mockReset().mockResolvedValue(JSON.stringify(plan));
  vi.mocked(chatStream).mockReset().mockImplementation(async function* () { yield "我在听，你继续。"; });
  await db.entry.deleteMany();
  await db.memory.deleteMany();
  await db.entry.create({ data: { id: "capsule", type: "text", text: "今天项目交了，觉得很累。", occurredAt: new Date() } });
});
afterEach(() => vi.unstubAllEnvs());

describe("creation-only multi-turn agent", () => {
  it("does not call the model until the user chooses to chat", async () => {
    expect(await db.xiaojuTurn.count()).toBe(0);
    expect(chat).not.toHaveBeenCalled();
    expect(chatStream).not.toHaveBeenCalled();
  });
  it("separates decision and expression without exposing scores, plans or model labels", async () => {
    const events = await submit();
    expect(events).toContain("event: delta");
    expect(events).toContain("event: done");
    expect(events).not.toContain("explicitEmotion");
    expect(events).not.toContain("execution");
    expect(events).not.toContain("weights");
    expect(chat).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ fallbackPolicy: "error", json: true }));
    expect(chatStream).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ fallbackPolicy: "error" }));
    expect(await db.entryMessage.count()).toBe(1);
  });
  it("supports more than three rounds and passes the actual dialogue into later calls", async () => {
    await submit();
    for (let i = 1; i <= 5; i++) expect(await submit(`接着说第${i}件事`, `turn-${i}`)).toContain("event: done");
    expect(await db.entryMessage.count()).toBe(11);
    const context = JSON.parse(vi.mocked(chat).mock.lastCall![0][1].content);
    expect(context.conversation.at(-1).content).toBe("接着说第5件事");
    expect((await db.xiaojuConversation.findUniqueOrThrow({ where: { entryId: "capsule" } })).status).toBe("active");
  });
  it("replays a completed request without another model call or duplicate message", async () => {
    await submit("说一件事", "same");
    const count = await db.entryMessage.count();
    const replay = await submit("说一件事", "same");
    expect(replay).toContain("event: message");
    expect(chat).toHaveBeenCalledTimes(1);
    expect(await db.entryMessage.count()).toBe(count);
  });
  it("keeps user input when the model fails, then retries without duplicating it", async () => {
    vi.mocked(chatStream).mockImplementationOnce(async function* () { yield "半句"; throw new Error("offline"); });
    expect(await submit("别分析我，先听我说", "retry")).toContain("event: error");
    expect(await db.entryMessage.count({ where: { role: "user" } })).toBe(1);
    expect(await db.entryMessage.count({ where: { role: "assistant" } })).toBe(0);
    expect(await submit("别分析我，先听我说", "retry")).toContain("event: done");
    expect(await db.entryMessage.count()).toBe(2);
  });
  it("fails clearly on decision error instead of answering with a template", async () => {
    vi.mocked(chat).mockRejectedValueOnce(new Error("timeout"));
    expect(await submit()).toContain("event: error");
    expect(chatStream).not.toHaveBeenCalled();
  });
  it("rejects concurrent requests and permits the next request after completion", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(chat).mockImplementationOnce(async () => { await gate; return JSON.stringify(plan); });
    const first = await POST(request(), params);
    expect((await POST(request("又一句", "second"), params)).status).toBe(409);
    release(); await first.text();
    expect(await submit("下一句", "third")).toContain("event: done");
  });
  it("skips chat and never reopens a saved conversation", async () => {
    await endConversation("capsule");
    expect((await db.xiaojuConversation.findUniqueOrThrow({ where: { entryId: "capsule" } })).status).toBe("skipped");
    expect((await POST(request(), params)).status).toBe(409);
    expect(chat).not.toHaveBeenCalled();
  });
  it("fences out late responses when the user ends during generation", async () => {
    const run = await beginTurn("capsule", "late", "说到这里");
    await endConversation("capsule");
    await expect(finishTurn(run, "不应保存", plan, [])).rejects.toMatchObject({ code: "CONVERSATION_CHANGED" });
    expect(await db.entryMessage.count({ where: { role: "assistant" } })).toBe(0);
    expect(await db.entryMessage.count({ where: { role: "user" } })).toBe(1);
  });
  it("cannot commit a response after a source memory was withdrawn", async () => {
    await db.memory.create({ data: { id: "source", kind: "event", content: "过去的旅行", occurredAt: new Date() } });
    const run = await beginTurn("capsule", "source-test", "想起那次旅行");
    await db.memory.update({ where: { id: "source" }, data: { status: "retracted", revision: 1 } });
    await expect(finishTurn(run, "旧回复", plan, [{ id: "source", revision: 0 }])).rejects.toMatchObject({ code: "MEMORY_CHANGED" });
    await failTurn(run);
  });
  it("does not recycle invalidated assistant facts through conversation history or state", async () => {
    await db.memory.create({ data: { id: "old-fact", kind: "fact", content: "旧事实", occurredAt: new Date() } });
    const run = await beginTurn("capsule", "old-fact-turn", "说说以前");
    await finishTurn(run, "使用旧事实的回答", { ...plan, focus: "旧事实焦点" }, [{ id: "old-fact", revision: 0 }]);
    const stored = await db.xiaojuConversation.findUniqueOrThrow({ where: { entryId: "capsule" } });
    await db.memory.update({ where: { id: "old-fact" }, data: { revision: 1, content: "已经更正" } });
    const context = await conversationContext("capsule", stored.state);
    expect(context.data.previousState).toEqual({});
    expect(context.data.conversation.some((m) => m.content === "使用旧事实的回答")).toBe(false);
    expect(context.data.conversation.some((m) => m.content === "说说以前")).toBe(true);
  });
  it("recovers an expired lease but prevents the old attempt from committing", async () => {
    const old = await beginTurn("capsule", "restart", "同一句话");
    await db.xiaojuConversation.update({ where: { entryId: "capsule" }, data: { leaseUntil: new Date(0) } });
    const current = await beginTurn("capsule", "restart", "同一句话");
    await expect(finishTurn(old, "旧结果", plan, [])).rejects.toBeDefined();
    await finishTurn(current, "恢复后的结果", plan, []);
    expect(await db.entryMessage.count({ where: { role: "user" } })).toBe(1);
    expect(await db.entryMessage.count({ where: { role: "assistant" } })).toBe(1);
  });
  it("allows zero extracted memories instead of manufacturing facts", () => {
    expect(ExtractionSchema.parse({ title: "随手记", summary: "", mood: 0, memories: [] }).memories).toEqual([]);
    expect(PlanSchema.safeParse({ ...plan, act: "unknown" }).success).toBe(false);
  });
  it("closes an in-flight SSE immediately and does not store a late response", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(chat).mockImplementationOnce(async () => { await gate; return JSON.stringify(plan); });
    const response = await POST(request("我先说到这里", "stop-now"), params);
    await endConversation("capsule");
    const events = await response.text();
    expect(events).not.toContain("event: done");
    release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await db.entryMessage.count({ where: { role: "assistant" } })).toBe(0);
    expect(await db.entryMessage.count({ where: { role: "user" } })).toBe(1);
  });
  it("keeps reflection evidence, admits only explicit preferences, and supports withdrawal", async () => {
    vi.stubEnv("CHAT_API_KEY", "test-only-not-a-real-key");
    await submit("不要分析我，先听我说。今天我很累", "preference");
    await endConversation("capsule");
    await db.memory.create({ data: { id: "preference-source", entryId: "capsule", kind: "preference", content: "不要分析我，先听我说", occurredAt: new Date() } });
    vi.mocked(chat).mockResolvedValueOnce(JSON.stringify({ items: [
      { kind: "preference", quote: "不要分析我，先听我说", content: "模型不应改写成性格标签" },
      { kind: "reflection", quote: "今天我很累", content: "这次交流提到疲惫" },
      { kind: "preference", quote: "我喜欢所有人无条件同意我", content: "没有来源的偏好不能写入" },
    ] }));
    await reflectConversation("capsule");
    const insights = await db.xiaojuInsight.findMany({ orderBy: { createdAt: "asc" } });
    expect(insights).toHaveLength(2);
    const preference = insights.find((i) => i.kind === "preference")!;
    expect(preference).toMatchObject({ content: "不要分析我，先听我说", status: "active" });
    expect(insights.find((i) => i.kind === "reflection")?.status).toBe("candidate");
    expect((await conversationContext("capsule", "{}")).data.preferences).toEqual(["不要分析我，先听我说"]);
    await db.memory.update({ where: { id: "preference-source" }, data: { status: "retracted", revision: 1 } });
    expect((await conversationContext("capsule", "{}")).data.preferences).toEqual([]);
    const response = await retractInsight(new Request("http://test/insights", { method: "DELETE" }), { params: Promise.resolve({ id: preference.id }) });
    expect(response.status).toBe(200);
    expect((await db.xiaojuInsight.findUniqueOrThrow({ where: { id: preference.id } })).status).toBe("retracted");
  });
});

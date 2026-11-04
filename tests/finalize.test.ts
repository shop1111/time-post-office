import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { existsSync, rmdirSync, unlinkSync } from "node:fs";
import { POST, GET } from "@/app/api/entries/[id]/finalize/route";
import { db } from "@/lib/db";
import { extractEntry, persistEntry } from "@/lib/memory/extract";
import { embed } from "@/lib/ai/provider";
import { refreshProfile } from "@/lib/memory/profile";
import { generateStoryCard } from "@/lib/story";
import { startFinalize } from "@/lib/jobs";
import { tryStartInterview } from "@/lib/entry-work";
import type { Extraction, FinalizeResult, FinalizeStatusResponse } from "@/lib/types";

const fixture = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, directory: "", url: "" }));
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@prisma/client");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  fixture.directory = mkdtempSync(join(tmpdir(), "time-post-office-finalize-"));
  fixture.url = `file:${join(fixture.directory, "test.db").replace(/\\/g, "/")}`;
  fixture.client = new PrismaClient({ datasources: { db: { url: fixture.url } } });
  return { db: fixture.client, parseJson: <T>(value: string | null, fallback: T): T => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } } };
});
vi.mock("@/lib/memory/extract", async (original) => {
  const actual = await original<typeof import("@/lib/memory/extract")>();
  return { ...actual, extractEntry: vi.fn(actual.extractEntry) };
});
vi.mock("@/lib/ai/provider", async (original) => {
  const actual = await original<typeof import("@/lib/ai/provider")>();
  return { ...actual, embed: vi.fn(actual.embed) };
});
vi.mock("@/lib/memory/profile", async (original) => {
  const actual = await original<typeof import("@/lib/memory/profile")>();
  return { ...actual, refreshProfile: vi.fn(actual.refreshProfile) };
});
vi.mock("@/lib/story", async (original) => {
  const actual = await original<typeof import("@/lib/story")>();
  return { ...actual, generateStoryCard: vi.fn(actual.generateStoryCard) };
});

beforeAll(() => {
  execFileSync(process.execPath, [join(process.cwd(), "node_modules/prisma/build/index.js"), "db", "push", "--skip-generate"], { env: { ...process.env, DATABASE_URL: fixture.url, RUST_LOG: "info", RUST_BACKTRACE: "1" }, stdio: "pipe", timeout: 30_000 });
}, 30_000);
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.stubEnv("CHAT_API_KEY", ""); vi.stubEnv("EMBED_MODE", "lite");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.$transaction([db.job.deleteMany(), db.entry.deleteMany(), db.entity.deleteMany(), db.profile.deleteMany()]);
});
afterAll(async () => {
  vi.unstubAllEnvs(); vi.restoreAllMocks();
  await fixture.client.$disconnect();
  // 仅移除本套测试创建的已知 SQLite 文件，不递归删除计算出的目录。
  for (const name of ["test.db", "test.db-journal", "test.db-wal", "test.db-shm"]) {
    const path = join(fixture.directory, name); if (existsSync(path)) unlinkSync(path);
  }
  rmdirSync(fixture.directory);
});
const context = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (sse = false, signal?: AbortSignal) => new Request("http://test/finalize", { method: "POST", headers: sse ? { Accept: "text/event-stream" } : {}, signal });
const create = () => db.entry.create({ data: { type: "text", text: "今天和小林去杭州散步，很开心。下周准备考试。", occurredAt: new Date("2026-11-03T10:00:00Z") } });
const get = async (id: string) => (await GET(new Request("http://test/finalize"), context(id))).json() as Promise<FinalizeStatusResponse>;
const jsonPost = async (id: string) => (await POST(request(), context(id))).json() as Promise<FinalizeResult>;
const gate = () => { let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; }); return { wait, release }; };

describe("finalize with isolated SQLite", () => {
  it("SSE按五阶段输出，最终JSON结构与旧接口相同", async () => {
    const entry = await create();
    const text = await (await POST(request(true), context(entry.id))).text();
    const events = text.trim().split("\n\n").map((block) => {
      const [name, data] = block.split("\n");
      return { event: name.slice(7), data: JSON.parse(data.slice(6)) };
    });
    expect(events.map(({ event, data }) => event === "stage" ? `${data.stage}:${data.status}` : event)).toEqual([
      "meta", "extract:started", "extract:completed", "embed:started", "embed:completed", "persist:started", "persist:completed",
      "profile:started", "profile:completed", "story:started", "story:completed", "done",
    ]);
    expect(events.at(-1)?.data).toMatchObject({ status: "completed", result: { entry: { interviewDone: true }, card: { id: expect.any(String) } } });
    expect(await jsonPost(entry.id)).toEqual(events.at(-1)?.data.result);
  });
  it("旧JSON字段齐全，重复POST复用任务/记忆ID/卡片，画像execution来自实际调用", async () => {
    const entry = await create();
    const first = await jsonPost(entry.id);
    expect(first).toMatchObject({ extraction: { title: expect.any(String) }, entry: { interviewDone: true }, card: { id: expect.any(String) }, memories: expect.any(Array) });
    expect(Object.keys(first.executions).sort()).toEqual(["embed", "extract", "profile", "story"]);
    expect(first.executions.profile?.mode).toBe("mock");
    const second = await jsonPost(entry.id);
    expect(second).toEqual(first);
    expect(await db.job.count()).toBe(1);
    expect(await db.memory.count()).toBe(first.memories.length);
    expect(extractEntry).toHaveBeenCalledTimes(1);
    expect(generateStoryCard).toHaveBeenCalledTimes(1);
    expect((await get(entry.id)).status).toBe("completed");
  });
  it("并发SSE/JSON复用同一任务，断开订阅后继续到完成", async () => {
    const entry = await create();
    const paused = gate();
    const original = vi.mocked(extractEntry).getMockImplementation()!;
    vi.mocked(extractEntry).mockImplementationOnce(async (...args) => { await paused.wait; return original(...args); });
    const abort = new AbortController();
    const first = await POST(request(true, abort.signal), context(entry.id));
    const second = await POST(request(true), context(entry.id));
    const json = POST(request(), context(entry.id));
    const reader = first.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("event: meta");
    abort.abort(); await reader.cancel();
    expect((await get(entry.id)).status).toBe("running");
    paused.release();
    const events = await second.text();
    const result = await (await json).json();
    expect(events).toContain('"reused":true');
    expect(events).toContain("event: done");
    expect(result.entry.interviewDone).toBe(true);
    expect(await db.job.count()).toBe(1);
    expect(extractEntry).toHaveBeenCalledTimes(1);
    expect(await db.memory.count()).toBe(result.memories.length);
    expect((await get(entry.id)).status).toBe("completed");
  });
  it.each(["profile", "story"] as const)("%s失败为partial，重试只重做失败阶段", async (stage) => {
    const entry = await create();
    if (stage === "profile") vi.mocked(refreshProfile).mockRejectedValueOnce(new Error("profile failed"));
    else vi.mocked(generateStoryCard).mockRejectedValueOnce(new Error("story failed"));
    const first = await jsonPost(entry.id);
    expect((await get(entry.id)).status).toBe("partial");
    expect(first.memories.length).toBeGreaterThan(0);
    if (stage === "story") expect(first.card).toBeNull();
    const remembered = first.memories[0];
    await db.memory.update({ where: { id: remembered.id }, data: { content: "用户后来纠正的记忆", userEdited: true } });
    const second = await jsonPost(entry.id);
    expect((await get(entry.id)).status).toBe("completed");
    expect(second.memories.map((m) => m.id)).toEqual(first.memories.map((m) => m.id));
    expect(second.memories.find((m) => m.id === remembered.id)?.content).toBe("用户后来纠正的记忆");
    expect(extractEntry).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(refreshProfile).toHaveBeenCalledTimes(stage === "profile" ? 2 : 1);
    expect(generateStoryCard).toHaveBeenCalledTimes(stage === "story" ? 2 : 1);
  });
  it("embed失败后复用提取检查点，SSE失败终态和GET一致", async () => {
    const entry = await create();
    vi.mocked(embed).mockRejectedValueOnce(new Error("embed failed"));
    const events = await (await POST(request(true), context(entry.id))).text();
    expect(events).toContain('"stage":"embed","status":"failed"');
    expect(events).toContain("event: error");
    expect((await get(entry.id)).error?.stage).toBe("embed");
    expect(await db.memory.count()).toBe(0);
    await jsonPost(entry.id);
    expect(extractEntry).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledTimes(2);
  });
  it("旧interviewDone记录复用保存记忆和卡片，不重抽也不重新向量化", async () => {
    const entry = await create();
    await db.entry.update({ where: { id: entry.id }, data: { interviewDone: true, title: "旧标题" } });
    const memory = await db.memory.create({ data: { entryId: entry.id, kind: "event", content: "旧记忆", occurredAt: entry.occurredAt, userEdited: true } });
    const card = await db.storyCard.create({ data: { entryId: entry.id, title: "旧卡片", narrative: "旧故事" } });
    const result = await jsonPost(entry.id);
    expect(result.memories[0].id).toBe(memory.id);
    expect(result.card?.id).toBe(card.id);
    expect(extractEntry).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
    expect(generateStoryCard).not.toHaveBeenCalled();
  });
  it("保存后遗忘全部记忆再重试，不会重新创建", async () => {
    const entry = await create();
    vi.mocked(generateStoryCard).mockRejectedValueOnce(new Error("story failed"));
    await jsonPost(entry.id);
    await db.memory.deleteMany({ where: { entryId: entry.id } });
    expect((await jsonPost(entry.id)).memories).toEqual([]);
    expect(extractEntry).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(await db.memory.count()).toBe(0);
  });
  it("persist检查点写入失败时，记忆和Entry终态一起回滚", async () => {
    const entry = await create();
    const extraction: Extraction = { title: "测试", summary: "测试", mood: 0, emotions: [], memories: [{ kind: "event", content: "测试记忆", importance: 5, entities: [] }] };
    await expect(persistEntry(entry.id, extraction, [Float32Array.of(1, 0)], async () => { throw new Error("checkpoint write failed"); })).rejects.toThrow("checkpoint write failed");
    expect(await db.memory.count()).toBe(0);
    expect((await db.entry.findUniqueOrThrow({ where: { id: entry.id } })).interviewDone).toBe(false);
  });
  it("故事删旧建新和检查点同事务，失败保留原卡片", async () => {
    const entry = await create();
    const old = await db.storyCard.create({ data: { entryId: entry.id, title: "旧卡片", narrative: "旧故事" } });
    await expect(generateStoryCard(entry.id, {}, async () => { throw new Error("checkpoint write failed"); })).rejects.toThrow("checkpoint write failed");
    expect((await db.storyCard.findMany({ where: { entryId: entry.id } })).map((c) => c.id)).toEqual([old.id]);
  });
  it("已保存后进程中断，GET可重试且重启任务不重复记忆", async () => {
    const entry = await create();
    vi.mocked(generateStoryCard).mockRejectedValueOnce(new Error("story failed"));
    const first = await jsonPost(entry.id);
    const job = await db.job.findFirstOrThrow();
    await db.job.update({ where: { id: job.id }, data: { status: "running", currentStage: "story" } });
    expect((await get(entry.id)).error?.code).toBe("JOB_INTERRUPTED");
    const second = await jsonPost(entry.id);
    expect(second.memories.map((m) => m.id)).toEqual(first.memories.map((m) => m.id));
    expect(extractEntry).toHaveBeenCalledTimes(1);
  });
  it("finalize等待已有追问并阻止新轮次，结束后释放占用", async () => {
    const entry = await create();
    const endInterview = tryStartInterview(entry.id)!;
    const pending = startFinalize(entry.id);
    expect(tryStartInterview(entry.id)).toBeNull();
    expect(extractEntry).not.toHaveBeenCalled();
    endInterview();
    const { run } = await pending;
    await run.done;
    const release = tryStartInterview(entry.id);
    expect(release).not.toBeNull(); release?.();
  });
  it("轮询读到旧running快照时，不把已完成任务覆盖成失败", async () => {
    const entry = await create();
    await jsonPost(entry.id);
    const completed = await db.job.findFirstOrThrow();
    vi.spyOn(db.job, "findFirst").mockResolvedValueOnce({ ...completed, status: "running" });
    expect((await get(entry.id)).status).toBe("completed");
    expect((await db.job.findUniqueOrThrow({ where: { id: completed.id } })).status).toBe("completed");
  });
  it("详情页重新生成卡片后，任务结果返回新卡片", async () => {
    const entry = await create();
    const first = await jsonPost(entry.id);
    const regenerated = await generateStoryCard(entry.id);
    expect(regenerated.id).not.toBe(first.card?.id);
    expect((await get(entry.id)).result?.card?.id).toBe(regenerated.id);
    expect((await jsonPost(entry.id)).card?.id).toBe(regenerated.id);
  });
  it("删除记录时一并删除它的任务", async () => {
    const { DELETE } = await import("@/app/api/entries/[id]/route");
    const entry = await create();
    await jsonPost(entry.id);
    expect(await db.job.count({ where: { targetId: entry.id } })).toBe(1);
    expect((await DELETE(new Request("http://test/entry", { method: "DELETE" }), context(entry.id))).status).toBe(200);
    expect(await db.job.count({ where: { targetId: entry.id } })).toBe(0);
    expect(await db.entry.count({ where: { id: entry.id } })).toBe(0);
  });
  it("部分完成后重试会真正重做失败步骤，而不是拿回旧错误", async () => {
    const entry = await create();
    vi.mocked(generateStoryCard).mockRejectedValueOnce(new Error("story failed"));
    const { run } = await startFinalize(entry.id);
    expect((await run.done).status).toBe("partial");
    // 紧接着重试：即使旧任务还没来得及从内存表移除，也应开始新的一次
    const retry = await startFinalize(entry.id);
    expect(retry.run).not.toBe(run);
    expect((await retry.run.done).status).toBe("completed");
    expect(generateStoryCard).toHaveBeenCalledTimes(2);
  });
  it("新记忆只清掉所在月份的回忆缓存", async () => {
    const entry = await create();
    await db.monthlyRecap.createMany({ data: [{ month: "2026-11", payload: "{}" }, { month: "2026-10", payload: "{}" }] });
    await jsonPost(entry.id);
    expect((await db.monthlyRecap.findMany()).map((r) => r.month)).toEqual(["2026-10"]);
  });
  it("撤回后，已完成任务的结果和恢复页都不再列出这条记忆", async () => {
    const entry = await create();
    const first = await jsonPost(entry.id);
    expect(first.memories.length).toBeGreaterThan(1);
    const [gone, ...kept] = first.memories;
    await db.memory.update({ where: { id: gone.id }, data: { status: "retracted" } });
    expect((await jsonPost(entry.id)).memories.map((m) => m.id)).toEqual(kept.map((m) => m.id));
    expect((await get(entry.id)).result?.memories.map((m) => m.id)).toEqual(kept.map((m) => m.id));
  });
  it("缺失记录/任务返回约定404错误体", async () => {
    expect((await POST(request(), context("missing"))).status).toBe(404);
    const entry = await create();
    const response = await GET(new Request("http://test/finalize"), context(entry.id));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "这条记录还没有收进邮局任务", code: "JOB_NOT_FOUND", retryable: false });
  });
});

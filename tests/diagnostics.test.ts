import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { GET } from "@/app/api/diagnostics/route";
import { POST } from "@/app/api/diagnostics/ping/route";
import { chat, chatStream } from "@/lib/ai/provider";
import { chatJson } from "@/lib/ai/json";
import { recordAiExecution, recentAiCalls, withAiPurpose } from "@/lib/ai/telemetry";
import { synthesizeSpeech } from "@/lib/ai/speech";
const f = vi.hoisted(() => ({ entries: vi.fn(), jobs: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { entry: { count: f.entries }, memory: { count: async () => 8 }, letter: { count: async () => 6 }, job: { count: f.jobs }, setting: { findUnique: async () => ({ value: String(7 * 86_400_000) }) } } }));
const globals = globalThis as unknown as { aiRecentCalls: unknown[]; diagnosticsPingAt: Map<string, number> };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T12:00:00Z")); globals.aiRecentCalls.length = 0; globals.diagnosticsPingAt.clear();
  f.entries.mockResolvedValue(23); f.jobs.mockImplementation(async ({ where }) => where.status === "running" ? 2 : 1);
  for (const role of ["CHAT", "VISION", "EMBED", "ASR", "TTS"]) { vi.stubEnv(`${role}_API_KEY`, ""); vi.stubEnv(`${role}_BASE_URL`, ""); vi.stubEnv(`${role}_MODEL`, ""); }
  vi.stubEnv("EMBED_MODE", "lite"); vi.stubEnv("TTS_VOICE", ""); vi.stubEnv("CHAT_THINKING", "off");
  vi.stubEnv("CHAT_TIMEOUT_MS", "45000"); vi.stubEnv("AI_TIMEOUT_MS", "45000"); vi.stubEnv("AI_RETRY_BASE_MS", "1");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ message: { content: "ok" } }] })));
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const ping = (role: unknown) => POST(new Request("http://test/ping", { method: "POST", body: JSON.stringify({ role }) }));
it("数据库计数、虚拟时钟和配置模式；GET不会主动调用模型", async () => {
  const result = await GET(); const value = await result.json();
  expect(value.now).toBe("2026-11-10T12:00:00.000Z"); expect(value.clockOffsetDays).toBe(7);
  expect(value.db).toEqual({ ok: true, entries: 23, memories: 8, letters: 6, jobs: { running: 2, failed: 1 } });
  expect(value.capabilities.map((c: { role: string }) => c.role)).toEqual(["chat", "vision", "embed", "asr", "tts"]);
  expect(value.capabilities.every((c: { configured: boolean }) => !c.configured)).toBe(true);
  expect(value.capabilities[2].model).toBe("lite"); expect(value.summary).toEqual({ remote: 0, mock: 0, fallback: 0 });
  expect(result.headers.get("cache-control")).toBe("no-store"); expect(fetch).not.toHaveBeenCalled();
});
it("完整凭据地址只暴露host，Key、凭据、查询参数及原文不出现在响应", async () => {
  vi.stubEnv("EMBED_MODE", "api"); vi.stubEnv("TTS_VOICE", "preset");
  for (const role of ["CHAT", "VISION", "EMBED", "ASR", "TTS"]) {
    vi.stubEnv(`${role}_API_KEY`, `  diagnostic-secret-${role}  `);
    vi.stubEnv(`${role}_BASE_URL`, "https://private-user:private-password@api.example/v1?secret=hidden-query");
    vi.stubEnv(`${role}_MODEL`, `model-diagnostic-secret-${role}`);
  }
  recordAiExecution("chat", { mode: "remote", durationMs: 3, model: "diagnostic-secret-CHAT", fallbackReason: "https://private-user:private-password@api.example/v1?secret=hidden-query" });
  const result = await (await GET()).json(); const serialized = JSON.stringify(result);
  for (const value of ["diagnostic-secret", "private-user", "private-password", "hidden-query", "/v1"]) expect(serialized).not.toContain(value);
  expect(result.capabilities.every((c: { host: string; configured: boolean }) => c.host === "api.example" && c.configured)).toBe(true);
  expect(result.capabilities[0].thinking).toBe("off");
});
it("官方chat思考开关与实际发送一致，lite不谎报远程向量已启用", async () => {
  vi.stubEnv("CHAT_API_KEY", "test-only-placeholder"); vi.stubEnv("CHAT_THINKING", "on");
  vi.stubEnv("EMBED_API_KEY", "test-only-placeholder"); vi.stubEnv("EMBED_BASE_URL", "https://embed.example/v1"); vi.stubEnv("EMBED_MODEL", "embed-model");
  const value = await (await GET()).json(); expect(value.capabilities[0]).toMatchObject({ configured: true, model: "deepseek-flash", host: "api.deepseek.com", thinking: "on" });
  expect(value.capabilities[2]).toMatchObject({ configured: false, model: "lite" });
});
it("缓冲最多30条，倒序返回，summary只统计窗口，外部修改不影响缓冲", async () => {
  for (let i = 0; i < 42; i++) { vi.advanceTimersByTime(1); recordAiExecution("chat", { mode: i < 12 ? "remote" : i < 32 ? "mock" : "fallback", durationMs: i }, "test"); }
  const value = await (await GET()).json(); expect(value.recent).toHaveLength(30);
  expect(value.recent[0].durationMs).toBe(41); expect(value.recent[29].durationMs).toBe(12);
  expect(value.summary).toEqual({ remote: 0, mock: 20, fallback: 10 });
  const copy = recentAiCalls(); copy[0].mode = "remote"; expect(recentAiCalls()[0].mode).toBe("fallback");
});
it("数据库失败仍能诊断能力和recent，计数明确标ok=false", async () => {
  f.entries.mockRejectedValueOnce(new Error("database offline")); const value = await (await GET()).json();
  expect(value.db.ok).toBe(false); expect(value.db.entries).toBe(0); expect(value.capabilities).toHaveLength(5); expect(value.clockOffsetDays).toBe(0);
});
it("未配置ping无外部请求；同能力5秒限频，chat和embed互不占窗口", async () => {
  const first = await ping("chat"); expect(first.status).toBe(200); expect(await first.json()).toMatchObject({ ok: false, execution: { mode: "mock", fallbackReason: "not_configured" } });
  expect((await ping("embed")).status).toBe(200); const limited = await ping("chat"); expect(limited.status).toBe(429);
  expect(await limited.json()).toMatchObject({ code: "PING_RATE_LIMITED", retryable: true }); expect(limited.headers.get("retry-after")).toBe("5");
  await vi.advanceTimersByTimeAsync(5000); expect((await ping("chat")).status).toBe(200); expect(fetch).not.toHaveBeenCalled();
  expect(recentAiCalls()).toHaveLength(3); expect(recentAiCalls().every(call => call.purpose === "ping")).toBe(true);
});
it.each(["tts", "vision", "asr", "invalid", null])("ping拒绝%s", async (role) => { expect((await ping(role)).status).toBe(400); expect(fetch).not.toHaveBeenCalled(); });
it("chat最小请求，15秒内失败并记录降级；并发请求在开始时限频", async () => {
  vi.stubEnv("CHAT_API_KEY", "test-only-placeholder"); let signal: AbortSignal | undefined;
  vi.mocked(fetch).mockImplementation(async (_url, init) => { signal = init?.signal as AbortSignal; return new Promise(() => {}); });
  const pending = ping("chat"); await vi.advanceTimersByTimeAsync(0); expect((await ping("chat")).status).toBe(429);
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({ max_tokens: 16, messages: [{ role: "user", content: "Reply only: ok" }] });
  await vi.advanceTimersByTimeAsync(15000); expect(await (await pending).json()).toMatchObject({ ok: false, execution: { mode: "fallback", durationMs: 15000, fallbackReason: "timeout" } });
  expect(signal?.aborted).toBe(true); expect(fetch).toHaveBeenCalledTimes(1);
});
it("已配置embed只编码一个词，成功返回remote", async () => {
  vi.stubEnv("EMBED_MODE", "api"); vi.stubEnv("EMBED_API_KEY", "test-only-placeholder"); vi.stubEnv("EMBED_BASE_URL", "https://embed.example/v1"); vi.stubEnv("EMBED_MODEL", "embed-model");
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ data: [{ index: 0, embedding: [1, 0] }] }));
  expect(await (await ping("embed")).json()).toMatchObject({ ok: true, execution: { mode: "remote", model: "embed-model" } });
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).input).toEqual(["ok"]);
});
it("JSON修复耗尽仅记录最终fallback，不把内部chat记成多次remote", async () => {
  vi.stubEnv("CHAT_API_KEY", "test-only-placeholder");
  const result = await chatJson(z.object({ title: z.string() }), [{ role: "user", content: "private diary" }], { purpose: "extract", mock: () => ({ title: "local" }) });
  expect(result.title).toBe("local"); expect(fetch).toHaveBeenCalledTimes(3);
  expect(recentAiCalls()).toHaveLength(1); expect(recentAiCalls()[0]).toMatchObject({ mode: "fallback", fallbackReason: "bad_json", purpose: "extract" });
  expect(JSON.stringify(recentAiCalls())).not.toContain("private diary");
});
it("异步purpose上下文隔离；普通调用和流都自动记录", async () => {
  await Promise.all([withAiPurpose("profile", () => chat([], { mock: () => "local" })), withAiPurpose("recap", () => chat([], { mock: () => "local" }))]);
  const consume = (async () => { for await (const _part of chatStream([], { purpose: "interview", mock: () => "你好" })) { /* consume */ } })();
  await vi.runAllTimersAsync(); await consume;
  expect(new Set(recentAiCalls().map(call => call.purpose))).toEqual(new Set(["profile", "recap", "interview"]));
});
it("TTS失败进入recent但仍抛错，不生成假音频", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
  await expect(synthesizeSpeech("private letter", { baseUrl: "https://tts.example/v1", apiKey: "test-only-placeholder", model: "test-tts", voice: "preset" })).rejects.toThrow();
  expect(recentAiCalls()[0]).toMatchObject({ role: "tts", purpose: "tts", mode: "fallback", fallbackReason: "http_401" });
});

import { expect, it, vi } from "vitest";
// 脚本是可直接由Node执行的ESM，测试从同一入口导入，不复制检查逻辑。
const modulePath = "../scripts/demo-check.mjs";
const { main, parseArgs, readSSE } = await import(modulePath);
const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const stream = (frames: string) => new Response(frames, { headers: { "Content-Type": "text/event-stream" } });
const timings = ["extract", "embed", "persist", "profile", "story"].map((stage, index) => ({ stage, status: "completed", durationMs: (index + 1) * 10 }));

it("未带--yes只打印说明，既不发请求也不清数据", async () => {
  const fetcher = vi.fn(), log = vi.fn(); expect(await main([], { fetcher, log })).toBe(0); expect(fetcher).not.toHaveBeenCalled();
  expect(log.mock.calls.join(" ")).toContain("清空目标服务器数据");
  expect(log.mock.calls.join(" ")).toContain("--real-all");
  expect(log.mock.calls.join(" ")).toContain("本地lite向量");
  expect(parseArgs(["--yes", "--runs", "3", "--base-url", "http://localhost:3001", "--real"])).toMatchObject({ runs: 3, real: true, yes: true, baseUrl: "http://localhost:3001" });
  expect(parseArgs(["--real-all", "--real"])).toMatchObject({ real: true, realAll: true });
});
it("参数错误只报固定code，不回显URL凭据", async () => {
  const log = vi.fn(), fetcher = vi.fn();
  expect(await main(["--yes", "--base-url", "https://private-user:private-key@example.test"], { log, fetcher })).toBe(1);
  expect(log.mock.calls.join(" ")).not.toContain("private-key"); expect(fetcher).not.toHaveBeenCalled();
  expect(() => parseArgs(["--runs", "0"])).toThrow(); expect(() => parseArgs(["--runs", "3abc"])).toThrow();
});
it("SSE跨chunk的中文和CRLF能解析，done必须完整", async () => {
  const text = (frame("delta", "你好") + frame("done", { ok: true })).replaceAll("\n", "\r\n"); const bytes = new TextEncoder().encode(text);
  const response = new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3)); c.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
  expect(await readSSE(response, "/api/test")).toEqual([{ event: "delta", data: "你好" }, { event: "done", data: { ok: true } }]);
  await expect(readSSE(stream(frame("delta", "残缺正文")), "/api/test")).rejects.toMatchObject({ code: "SSE_MISSING_DONE" });
  await expect(readSSE(stream('event: done\ndata: {}'), "/api/test")).rejects.toMatchObject({ code: "SSE_MISSING_DONE" });
});
it("SSE错误只抛code，不包含服务端正文；done后的错误不能被忽略", async () => {
  await expect(readSSE(stream(frame("error", { code: "UPSTREAM_FAILED", message: "private prompt" })), "/api/test")).rejects.toMatchObject({ code: "UPSTREAM_FAILED", message: "UPSTREAM_FAILED" });
  await expect(readSSE(stream(frame("error", { code: "timeout", message: "private prompt" })), "/api/test")).rejects.toMatchObject({ code: "timeout" });
  await expect(readSSE(stream(frame("done", {}) + frame("error", { code: "FAILED" })), "/api/test")).rejects.toMatchObject({ code: "SSE_AFTER_DONE" });
});

function server(mode: "remote" | "mock" | "fallback" = "mock", broken: "none" | "interview" | "persist" = "none", embedding: "lite" | "remote" | "fallback" | "unconfigured" = "lite") {
  let calls: Array<Record<string, unknown>> = [], counter = 0, resolved = false, offset = 0, loads = 0, resets = 0;
  const info = { mode, model: "test", durationMs: 1, ...(mode === "fallback" ? { fallbackReason: "http_5xx" } : {}) };
  const embedInfo = embedding === "lite" || embedding === "unconfigured" ? { mode: "mock", model: "lite", durationMs: 1, fallbackReason: "not_configured" } : { mode: embedding, model: "test-embed", durationMs: 1, ...(embedding === "fallback" ? { fallbackReason: "http_5xx" } : {}) };
  const record = (role = "chat") => { calls.unshift({ at: new Date(1700000000000 + counter++).toISOString(), role, ...(role === "embed" ? embedInfo : info) }); calls = calls.slice(0, 30); };
  const result = (id: string) => ({ entry: { id, interviewDone: true }, card: { id: "card" }, memories: [{ id: "memory" }], executions: Object.fromEntries(["extract", "embed", "profile", "story"].map(stage => [stage, stage === "embed" ? embedInfo : info])) });
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    if (path === "/api/diagnostics") return Response.json({ db: { ok: true }, recent: calls, clockOffsetDays: offset, capabilities: [{ role: "embed", configured: embedding === "remote" || embedding === "fallback", ...(embedding !== "unconfigured" ? { model: embedding === "lite" ? "lite" : "test-embed" } : {}) }] });
    if (path === "/api/demo") { loads++; resolved = false; offset = 0; record("embed"); return Response.json({ ok: true, entries: 1, letters: 1 }); }
    if (path === "/api/export") return Response.json({ entries: [{ id: "entry", occurredAt: "2026-08-09T12:00:00Z" }], memories: [{ id: "exam", kind: "plan", content: "认证考试", dueAt: "2026-11-07T12:00:00Z", resolved }], letters: [{ id: "seed", body: "private seed", checkStatus: "unchecked" }, { id: "letter", body: "信件正文。", checkStatus: "passed" }, { id: "anniversary", body: "private letter", checkStatus: "rewritten" }] });
    if (path === "/api/postman") {
      const input = JSON.parse(String(init.body));
      if (input.action === "reset") { resets++; offset = 0; return Response.json({ ok: true }); }
      if (input.action === "tick") return Response.json({ decisions: [] });
      offset = 7; record("embed"); record();
      const stages = [{ name: "retrieve", execution: embedInfo }, { name: "generate", execution: info }, { name: "check", execution: info }];
      return stream(frame("done", { result: { generated: ["letter", "anniversary"], decisions: [{ key: "loop:exam", type: "open_loop", outcome: "generated", letterId: "letter", stages }, { key: "anniversary", type: "anniversary", outcome: "generated", letterId: "anniversary", stages }] } }));
    }
    if (path === "/api/letters/letter/sources") return Response.json({ letterId: "letter", sentences: [{ text: "信件正文。", sources: [] }] });
    if (path === "/api/letters/letter") { record(); resolved = true; return Response.json({ resolvedPlanIds: ["exam"], replyEntryId: "reply", jobId: "job", execution: info }); }
    if (path === "/api/entries/reply/finalize") return Response.json({ jobId: "job", status: "completed", stages: timings, result: result("reply") });
    if (path === "/api/entries") return Response.json({ entry: { id: "new" } });
    if (path === "/api/entries/new/interview") { record(); return stream(frame("heartbeat", {}) + frame("delta", "") + frame("delta", "private diary") + frame("delta", "more private text") + (broken === "interview" ? "" : frame("done", { execution: info }))); }
    if (path === "/api/entries/new/finalize") { record(); return stream(timings.filter(s => broken !== s.stage).map(s => frame("stage", s)).join("") + frame("done", { status: "completed", result: result("new") })); }
    if (path === "/api/recap/2026-08") { record(); return Response.json({ recap: { month: "2026-08", stats: { count: 1 }, narrative: "private narrative" } }); }
    throw new Error("unexpected interface with private details");
  });
  return { fetcher, counts: () => ({ loads, resets, resolved, offset }) };
}
it("完整两轮只走HTTP，每轮重载与复位且不打印正文", async () => {
  const fake = server(), log = vi.fn(); expect(await main(["--yes", "--runs", "2"], { fetcher: fake.fetcher, log })).toBe(0);
  expect(fake.counts()).toMatchObject({ loads: 2, resets: 2, resolved: true, offset: 0 });
  const output = log.mock.calls.join("\n"); expect(output).toContain("runs=2/2 steps=20/20 result=PASS"); expect(output).not.toContain("private");
  expect(output.match(/interview.firstDeltaMs=/g)).toHaveLength(2);
  expect(output.match(/checks.generated=2 passed=1 rewritten=1 failed=0 unchecked=0/g)).toHaveLength(2);
  expect(output).toContain("[METRIC] entryFinalize extractMs=10 embedMs=20 persistMs=30 profileMs=40 storyMs=50");
  expect(output).toContain("[METRIC] replyFinalize extractMs=10 embedMs=20 persistMs=30 profileMs=40 storyMs=50");
});
it("SSE计时回调在首段到达时执行，不等done或响应关闭", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const onEvent = vi.fn();
  const response = new Response(new ReadableStream({ start(c) { controller = c; } }), { headers: { "Content-Type": "text/event-stream" } });
  let complete = false;
  const pending = readSSE(response, "/api/test", onEvent).then((value: unknown) => { complete = true; return value; });
  controller.enqueue(new TextEncoder().encode(frame("delta", "private first word")));
  await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(1));
  expect(complete).toBe(false);
  controller.enqueue(new TextEncoder().encode(frame("done", {}))); controller.close(); await pending;
  expect(onEvent).toHaveBeenCalledTimes(2);
});
it.each(["mock", "fallback"] as const)("--real允许lite载入，遇到首个聊天类%s失败且尝试复位", async mode => {
  const fake = server(mode), log = vi.fn(); expect(await main(["--yes", "--real"], { fetcher: fake.fetcher, log })).toBe(1);
  expect(log.mock.calls.join("\n")).toContain("REAL_MODE_REQUIRED"); expect(fake.counts()).toMatchObject({ loads: 1, resets: 1, offset: 0 });
  expect(log.mock.calls.join("\n")).toContain("[PASS] 载入示例人生");
  expect(log.mock.calls.join("\n")).toContain("[FAIL] 快进7天（SSE）");
});
it("--real聊天remote配合lite向量通过，包括finalize和邮差阶段execution", async () => { const fake = server("remote"); expect(await main(["--yes", "--real"], { fetcher: fake.fetcher, log: vi.fn() })).toBe(0); });
it.each(["--real", "--real-all"])("%s全部remote通过", async flag => { const fake = server("remote", "none", "remote"); expect(await main(["--yes", flag], { fetcher: fake.fetcher, log: vi.fn() })).toBe(0); });
it.each(["lite", "fallback", "unconfigured"] as const)("--real-all拒绝%s向量", async embedding => {
  const fake = server("remote", "none", embedding), log = vi.fn();
  expect(await main(["--yes", "--real-all"], { fetcher: fake.fetcher, log })).toBe(1);
  expect(log.mock.calls.join("\n")).toContain("[FAIL] 载入示例人生"); expect(fake.counts().resets).toBe(1);
});
it.each(["fallback", "unconfigured"] as const)("--real也拒绝API向量%s", async embedding => {
  const fake = server("remote", "none", embedding), log = vi.fn();
  expect(await main(["--yes", "--real"], { fetcher: fake.fetcher, log })).toBe(1);
  expect(log.mock.calls.join("\n")).toContain("[FAIL] 载入示例人生");
});
it.each([["interview", "SSE_MISSING_DONE"], ["persist", "MISSING_STAGE_PERSIST"]] as const)("%s不完整不能假通过，仍复位时钟", async (broken, code) => {
  const fake = server("mock", broken), log = vi.fn(); expect(await main(["--yes"], { fetcher: fake.fetcher, log })).toBe(1);
  expect(log.mock.calls.join("\n")).toContain(code); expect(fake.counts().offset).toBe(0); expect(fake.counts().resets).toBe(1);
});
it("HTTP错误保留接口和code，绝不输出error正文", async () => {
  const fetcher = vi.fn(async () => Response.json({ error: "private key and prompt", code: "DB_FAILED" }, { status: 500 })), log = vi.fn();
  expect(await main(["--yes"], { fetcher, log })).toBe(1); const output = log.mock.calls.join("\n");
  expect(output).toContain("/api/diagnostics"); expect(output).toContain("DB_FAILED"); expect(output).not.toContain("private");
});

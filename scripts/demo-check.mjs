import { pathToFileURL } from "node:url";

const MODES = ["remote", "mock", "fallback"];
const STAGES = ["extract", "embed", "persist", "profile", "story"];
const AI_STAGES = ["extract", "embed", "profile", "story"];
const codeOf = (code, fallback) => typeof code === "string" && /^[a-z][a-z0-9_]{0,79}$/i.test(code) ? code : fallback;
const routeOf = (path) => path.replace(/^(\/api\/(?:entries|letters))\/[^/]+/, "$1/{id}").replace(/^\/api\/recap\/[^/]+/, "/api/recap/{month}");
export class DemoCheckError extends Error {
  constructor(route, code) { super(code); this.route = routeOf(route); this.code = codeOf(code, "CHECK_FAILED"); }
}
const check = (condition, route, code) => { if (!condition) throw new DemoCheckError(route, code); };
export function parseArgs(args) {
  const options = { baseUrl: "http://localhost:3000", runs: 1, yes: false, real: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--yes") options.yes = true;
    else if (arg === "--real") options.real = true;
    else if (arg === "--help") options.help = true;
    else if (arg === "--runs") { const value = args[++i]; check(/^\d+$/.test(value ?? ""), "CLI", "INVALID_RUNS"); options.runs = Number(value); }
    else if (arg === "--base-url") options.baseUrl = args[++i] ?? "";
    else throw new DemoCheckError("CLI", "UNKNOWN_ARGUMENT");
  }
  check(Number.isSafeInteger(options.runs) && options.runs >= 1 && options.runs <= 20, "CLI", "INVALID_RUNS");
  let url;
  try { url = new URL(options.baseUrl); } catch { throw new DemoCheckError("CLI", "INVALID_BASE_URL"); }
  check(["http:", "https:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/", "CLI", "INVALID_BASE_URL");
  options.baseUrl = url.origin;
  return options;
}

/** 严格要求完整done帧；处理跨chunk/CRLF/多行data，不打印任何载荷。 */
export async function readSSE(response, route) {
  check(response.headers.get("content-type")?.includes("text/event-stream") && response.body, route, "EXPECTED_SSE");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  const events = []; let buffer = "", event = "message", data = [], terminal = false;
  const line = (text) => {
    if (text === "") {
      if (data.length) {
        let value;
        try { value = JSON.parse(data.join("\n")); } catch { throw new DemoCheckError(route, "INVALID_SSE_JSON"); }
        check(!terminal, route, "SSE_AFTER_DONE");
        if (event === "error") throw new DemoCheckError(route, codeOf(value?.code, "SSE_ERROR"));
        if (event === "done") terminal = true;
        events.push({ event, data: value });
      }
      event = "message"; data = [];
    } else if (text.startsWith("event:")) event = text.slice(6).trim();
    else if (text.startsWith("data:")) data.push(text.slice(5).replace(/^ /, ""));
  };
  try {
    for (;;) {
      const part = await reader.read(); buffer += part.done ? decoder.decode() : decoder.decode(part.value, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n")) !== -1) { line(buffer.slice(0, end).replace(/\r$/, "")); buffer = buffer.slice(end + 1); }
      if (part.done) break;
    }
    check(terminal && !buffer && !data.length, route, "SSE_MISSING_DONE");
    return events;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

function newCalls(before, after, route) {
  const counts = new Map();
  for (const call of before) { const key = JSON.stringify(call); counts.set(key, (counts.get(key) ?? 0) + 1); }
  let overlap = 0;
  const calls = after.filter(call => {
    const key = JSON.stringify(call), count = counts.get(key) ?? 0;
    if (count) { counts.set(key, count - 1); overlap++; return false; } return true;
  });
  check(!(before.length && after.length === 30 && !overlap), route, "TELEMETRY_WINDOW_OVERFLOW");
  return calls;
}

export async function runDemoCheck(options, { fetcher = fetch, log = console.log, pause = (ms) => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  check(options.yes, "CLI", "CONFIRMATION_REQUIRED");
  const results = []; let completedRuns = 0;
  async function request(path, body, sse = false) {
    const headers = new Headers();
    const multipart = body instanceof FormData;
    if (body !== undefined && !multipart) headers.set("Content-Type", "application/json");
    if (sse) headers.set("Accept", "text/event-stream");
    try {
      const response = await fetcher(options.baseUrl + path, { method: body === undefined ? "GET" : "POST", headers,
        ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {}), signal: AbortSignal.timeout(body === undefined ? 30_000 : 600_000) });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new DemoCheckError(path, codeOf(error?.code, `HTTP_${response.status}`));
      }
      if (sse) return await readSSE(response, path);
      return await response.json().catch(() => { throw new DemoCheckError(path, "INVALID_JSON"); });
    } catch (error) {
      if (error instanceof DemoCheckError) throw error;
      throw new DemoCheckError(path, error?.name === "TimeoutError" || error?.name === "AbortError" ? "REQUEST_TIMEOUT" : "NETWORK_OR_STREAM_FAILED");
    }
  }
  const diagnostics = async () => {
    const value = await request("/api/diagnostics");
    check(value.db?.ok && Array.isArray(value.recent), "/api/diagnostics", "DIAGNOSTICS_UNAVAILABLE");
    return value;
  };
  async function step(name, route, work, requireAI = false, observe = true) {
    const started = Date.now(); let modes = [];
    try {
      const before = observe ? await diagnostics() : { recent: [] }; const direct = [];
      const record = (execution) => { check(execution && MODES.includes(execution.mode), route, "MISSING_EXECUTION"); direct.push(execution); };
      const value = await work(record); const after = observe ? await diagnostics() : { recent: [] };
      const calls = newCalls(before.recent, after.recent, route);
      if (requireAI) check(calls.length > 0, route, "MISSING_AI_TELEMETRY");
      modes = [...new Set([...calls, ...direct].map(call => call.mode))];
      check(modes.every(mode => MODES.includes(mode)), route, "INVALID_EXECUTION_MODE");
      if (options.real) check([...calls, ...direct].every(call => call.mode === "remote" && !call.fallbackReason), route, "REAL_MODE_REQUIRED");
      const durationMs = Date.now() - started;
      log(`[PASS] ${name} | ${durationMs}ms | AI=${modes.join("+") || "none"}`);
      results.push({ name, ok: true, durationMs, modes }); return value;
    } catch (error) {
      const failure = error instanceof DemoCheckError ? error : new DemoCheckError(route, "INVALID_RESPONSE");
      const durationMs = Date.now() - started;
      log(`[FAIL] ${name} | ${durationMs}ms | AI=${modes.join("+") || "unknown"} | ${failure.route} | code=${failure.code}`);
      results.push({ name, ok: false, durationMs, modes }); throw failure;
    }
  }
  const finalized = (state, route, record) => {
    check(state.status === "completed" && state.result?.entry?.interviewDone && state.result?.card && state.result?.memories?.length, route, "FINALIZE_INCOMPLETE");
    for (const stage of AI_STAGES) record(state.result.executions?.[stage]);
  };
  const postmanExecutions = (result, record) => {
    check(Array.isArray(result.decisions) && result.decisions.every(d => d.outcome !== "failed" && d.outcome !== "selected"), "/api/postman", "POSTMAN_INCOMPLETE");
    for (const decision of result.decisions) for (const stage of decision.stages ?? []) if (stage.execution) record(stage.execution);
  };
  let failed = false;
  for (let run = 1; run <= options.runs; run++) {
    log(`Run ${run}/${options.runs} (${options.real ? "real" : "mock/fallback allowed"})`);
    let touched = false, runFailed = false;
    try {
      const snapshot = await step("载入示例人生", "/api/demo", async () => {
        touched = true;
        const loaded = await request("/api/demo", { action: "load" });
        check(loaded.ok && loaded.entries > 0 && loaded.letters > 0, "/api/demo", "DEMO_LOAD_FAILED");
        return request("/api/export");
      }, true);
      const exam = snapshot.memories.find(m => m.kind === "plan" && !m.resolved && /考试/.test(m.content) && m.dueAt);
      check(exam, "/api/export", "EXAM_PLAN_MISSING");
      await step("巡检", "/api/postman", async record => { const result = await request("/api/postman", { action: "tick" }); postmanExecutions(result, record); });
      const forward = await step("快进7天（SSE）", "/api/postman", async record => {
        const events = await request("/api/postman", { action: "forward", days: 7 }, true);
        const result = events.find(e => e.event === "done")?.data?.result;
        postmanExecutions(result, record);
        for (const type of ["open_loop", "anniversary"]) check(result.decisions.some(d => d.type === type && d.outcome === "generated" && result.generated.includes(d.letterId)), "/api/postman", `MISSING_${type.toUpperCase()}_LETTER`);
        check(result.decisions.some(d => d.key === `loop:${exam.id}` && d.outcome === "generated"), "/api/postman", "EXAM_LETTER_MISSING");
        return result;
      }, true);
      const letterId = forward.decisions.find(d => d.key === `loop:${exam.id}` && d.outcome === "generated").letterId;
      await step("读取新信出处", "/api/letters/{id}/sources", async () => {
        const sources = await request(`/api/letters/${encodeURIComponent(letterId)}/sources`);
        const exported = await request("/api/export"); const letter = exported.letters.find(l => l.id === letterId);
        check(sources.letterId === letterId && Array.isArray(sources.sentences) && sources.sentences.map(s => s.text).join("") === letter?.body, "/api/letters/{id}/sources", "SOURCES_BODY_MISMATCH");
        check(sources.sentences.every(s => Array.isArray(s.sources) && s.sources.length <= 2), "/api/letters/{id}/sources", "INVALID_SOURCES");
      });
      await step("回信关闭考试计划并完成整理", "/api/letters/{id}", async record => {
        const saved = await request(`/api/letters/${encodeURIComponent(letterId)}`, { action: "reply", reply: "UX设计认证考试考完了，过了！" });
        record(saved.execution);
        check(saved.resolvedPlanIds?.includes(exam.id) && saved.replyEntryId && saved.jobId, "/api/letters/{id}", "PLAN_NOT_RESOLVED");
        const route = `/api/entries/${encodeURIComponent(saved.replyEntryId)}/finalize`;
        const deadline = Date.now() + 600_000; let state;
        do { state = await request(route); if (["completed", "partial", "failed"].includes(state.status)) break; await pause(500); } while (Date.now() < deadline);
        check(state?.jobId === saved.jobId, route, "JOB_MISMATCH"); finalized(state, route, record);
        const exported = await request("/api/export"); check(exported.memories.some(m => m.id === exam.id && m.resolved), "/api/export", "PLAN_NOT_RESOLVED");
      }, true);
      const entryId = await step("新建文字日记", "/api/entries", async () => {
        const form = new FormData(); form.set("type", "text"); form.set("text", "今天和小鹿在杭州西湖散步，拍到了金色的落日。考试结束后轻松了很多，很开心能一起慢慢走回家。");
        const saved = await request("/api/entries", form); check(saved.entry?.id, "/api/entries", "ENTRY_NOT_CREATED"); return saved.entry.id;
      });
      await step("追问（SSE）", "/api/entries/{id}/interview", async record => {
        const events = await request(`/api/entries/${encodeURIComponent(entryId)}/interview`, {}, true);
        check(events.some(e => e.event === "delta" && typeof e.data === "string" && e.data.length), "/api/entries/{id}/interview", "EMPTY_INTERVIEW");
        record(events.find(e => e.event === "done")?.data?.execution);
      }, true);
      await step("收进邮局（SSE五阶段）", "/api/entries/{id}/finalize", async record => {
        const route = `/api/entries/${encodeURIComponent(entryId)}/finalize`, events = await request(route, {}, true);
        for (const stage of STAGES) check(events.some(e => e.event === "stage" && e.data.stage === stage && e.data.status === "completed"), route, `MISSING_STAGE_${stage.toUpperCase()}`);
        const done = events.find(e => e.event === "done")?.data; check(done?.result?.entry?.id === entryId, route, "ENTRY_MISMATCH"); finalized(done, route, record);
      }, true);
      await step("读取月度回忆", "/api/recap/{month}", async () => {
        const counts = new Map(); for (const entry of snapshot.entries) { const month = entry.occurredAt.slice(0, 7); counts.set(month, (counts.get(month) ?? 0) + 1); }
        const month = [...counts].sort((a, b) => b[1] - a[1])[0][0];
        const value = await request(`/api/recap/${month}`, {});
        check(value.recap?.month === month && value.recap.stats?.count > 0 && typeof value.recap.narrative === "string" && value.recap.narrative.length > 0, "/api/recap/{month}", "RECAP_INCOMPLETE");
      }, true);
    } catch (error) {
      runFailed = true;
      if (!(results.at(-1)?.ok === false)) log(`[FAIL] ${error instanceof DemoCheckError ? error.route : "CHECK"} | code=${error instanceof DemoCheckError ? error.code : "INVALID_RESPONSE"}`);
    } finally {
      if (touched) try {
        await step("时钟拨回今天", "/api/postman", async () => { const reset = await request("/api/postman", { action: "reset" }); check(reset.ok, "/api/postman", "CLOCK_RESET_FAILED"); const state = await diagnostics(); check(state.clockOffsetDays === 0, "/api/diagnostics", "CLOCK_NOT_RESET"); }, false, false);
      } catch { runFailed = true; }
    }
    if (runFailed) { failed = true; break; }
    completedRuns++;
  }
  const passed = results.filter(result => result.ok).length;
  log(`SUMMARY runs=${completedRuns}/${options.runs} steps=${passed}/${results.length} result=${failed ? "FAIL" : "PASS"}`);
  return { ok: !failed, completedRuns, results };
}

export async function main(args = process.argv.slice(2), dependencies = {}) {
  const log = dependencies.log ?? console.log;
  try {
    const options = parseArgs(args);
    if (options.help || !options.yes) {
      log("此脚本会清空目标服务器数据并重新载入示例人生；每轮都会重置，结束后保留验收数据。必须带 --yes 才执行。\n先启动服务器，再运行：npm run demo:check -- --yes --base-url http://localhost:3001 --runs 2\n--runs 3 连续三轮；--real 要求所有AI步骤remote（包括向量），Mock/降级均失败。默认服务器：http://localhost:3000。失败仍尝试恢复时钟；不会打印正文、提示词或Key。");
      return 0;
    }
    return (await runDemoCheck(options, dependencies)).ok ? 0 : 1;
  } catch (error) {
    log(`[FAIL] ${error instanceof DemoCheckError ? error.route : "CHECK"} | code=${error instanceof DemoCheckError ? error.code : "CHECK_FAILED"}`);
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();

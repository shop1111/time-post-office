/** 兼容旧返回值；onExecution 回调提供执行元数据。 */
import { embedLite } from "@/lib/memory/embed-lite";
import type { ExecutionInfo } from "@/lib/types";
import { acquire, AiFailure, assertOk, backoff, bounded, Budget, failureOf, positiveEnv, requestJson } from "./transport";
import { recordAiExecution } from "./telemetry";

export type Role = "chat" | "vision" | "embed" | "asr";
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
interface RoleConfig { baseUrl: string; apiKey: string; model: string }
export interface CallOptions {
  onExecution?: (execution: ExecutionInfo) => void;
  purpose?: string;
  /** 可缩短配置预算；JSON修复共享剩余预算。 */
  timeoutMs?: number;
}
export interface ChatOptions extends CallOptions {
  temperature?: number; maxTokens?: number; json?: boolean; mock: () => string;
  /** 返回被 max_tokens 截断的正文（由调用方修复），而不是当作失败降级。 */
  allowTruncated?: boolean;
}
export function roleConfig(role: Role): RoleConfig | null {
  const p = role.toUpperCase();
  const apiKey = process.env[`${p}_API_KEY`]?.trim();
  const baseUrl = process.env[`${p}_BASE_URL`]?.trim() || (role === "chat" ? "https://api.deepseek.com" : "");
  const model = process.env[`${p}_MODEL`]?.trim() || (role === "chat" ? "deepseek-flash" : "");
  return baseUrl && apiKey && model ? { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model } : null;
}
export const isMock = () => roleConfig("chat") === null;
export function providerStatus() {
  const embedCfg = process.env.EMBED_MODE === "api" ? roleConfig("embed") : null;
  return {
    mock: isMock(), chat: roleConfig("chat")?.model ?? null, vision: roleConfig("vision")?.model ?? null,
    embed: embedCfg?.model ?? "lite（本地 n-gram 哈希向量）", asr: roleConfig("asr")?.model ?? "浏览器 Web Speech API",
  };
}
export function callTimeout(role: Role, options: CallOptions = {}) {
  // 思考模式先推理再作答，未显式配置时放宽默认预算。
  const fallback = thinkingOn(roleConfig(role)) ? 120_000 : 45_000;
  const limit = positiveEnv(`${role.toUpperCase()}_TIMEOUT_MS`, positiveEnv("AI_TIMEOUT_MS", fallback));
  return options.timeoutMs === undefined ? limit : Math.max(1, Math.min(limit, options.timeoutMs));
}
function isDeepSeek(cfg: RoleConfig) {
  try { return new URL(cfg.baseUrl).hostname === "api.deepseek.com"; }
  catch { return false; /* 无效地址在请求阶段统一降级 */ }
}
export function thinkingOn(cfg: RoleConfig | null) {
  return !!cfg && isDeepSeek(cfg) && /^(on|true|1|enabled)$/i.test(process.env.CHAT_THINKING ?? "off");
}
function thinking(cfg: RoleConfig) {
  // 只向DeepSeek官方发送其扩展参数，其他兼容服务不受影响。
  return isDeepSeek(cfg) ? { thinking: { type: thinkingOn(cfg) ? "enabled" : "disabled" } } : {};
}
/** 推理 token 计入 max_tokens：思考模式下在业务长度之外追加推理预算，避免正文被截断。 */
export function maxTokensFor(cfg: RoleConfig, base: number) {
  return thinkingOn(cfg) ? base + positiveEnv("CHAT_THINKING_BUDGET_TOKENS", 4_000) : base;
}
function jsonInit(cfg: RoleConfig, body: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` }, body: JSON.stringify(body) };
}
function content(data: unknown, allowTruncated = false): string {
  const choice = (data as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }> })?.choices?.[0];
  if (typeof choice?.message?.content !== "string" || !choice.message.content.trim()) throw new AiFailure("bad_json");
  if (choice.finish_reason === "length" && !allowTruncated) throw new AiFailure("bad_json");
  return choice.message.content;
}
function execution(mode: ExecutionInfo["mode"], started: number, model?: string, fallbackReason?: string): ExecutionInfo {
  return { mode, ...(model ? { model } : {}), durationMs: Date.now() - started, ...(fallbackReason ? { fallbackReason } : {}) };
}
async function run<T>(role: Role, cfg: RoleConfig | null, options: CallOptions, remote: (cfg: RoleConfig, budget: Budget) => Promise<T>, mock: () => T): Promise<T> {
  const started = Date.now();
  let value: T;
  let info: ExecutionInfo;
  if (!cfg) {
    value = mock();
    info = execution("mock", started, role === "embed" ? "lite" : undefined, "not_configured");
  } else {
    const budget = new Budget(callTimeout(role, options));
    try {
      value = await remote(cfg, budget);
      info = execution("remote", started, cfg.model);
    } catch (error) {
      const reason = failureOf(error).reason;
      console.warn(`[ai.${role}] fallback ${reason}`);
      value = mock();
      info = execution("fallback", started, cfg.model, reason);
    } finally { budget.dispose(); }
  }
  // 回调异常不能被误当作模型错误或造成二次回调。
  recordAiExecution(role, info, options.purpose);
  options.onExecution?.(info);
  return value;
}
export async function chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  return run("chat", roleConfig("chat"), opts, (cfg, budget) => requestJson(`${cfg.baseUrl}/chat/completions`, jsonInit(cfg, {
    model: cfg.model, messages, temperature: opts.temperature ?? 0.8, max_tokens: maxTokensFor(cfg, opts.maxTokens ?? 1200),
    ...thinking(cfg), ...(opts.json ? { response_format: { type: "json_object" } } : {}),
  }), budget, (data) => content(data, opts.allowTruncated)), opts.mock);
}
/** 已有文字后失败：不重试、不拼接Mock，交由路由输出结构化error。 */
export class ChatStreamError extends Error {
  constructor(public readonly code: string, public readonly retryable: boolean, public readonly execution: ExecutionInfo) {
    super(`AI 流中断：${code}`);
    this.name = "ChatStreamError";
  }
}
export async function* chatStream(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<string> {
  const started = Date.now();
  const report = (info: ExecutionInfo) => { recordAiExecution("chat", info, opts.purpose); opts.onExecution?.(info); };
  const cfg = roleConfig("chat");
  if (!cfg) {
    yield* fakeStream(opts.mock());
    report(execution("mock", started, undefined, "not_configured"));
    return;
  }
  const budget = new Budget(Math.min(opts.timeoutMs ?? Infinity, positiveEnv("AI_STREAM_TOTAL_TIMEOUT_MS", thinkingOn(cfg) ? 180_000 : 90_000)));
  // emitted：已向用户输出正文（之后失败不能重试）；推理内容只算「还活着」，不输出给用户。
  let emitted = false;
  let failure: AiFailure | undefined;
  try {
    for (let attempt = 0; ; attempt++) {
      let release: (() => void) | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const controller = new AbortController();
      const signal = AbortSignal.any([budget.signal, controller.signal]);
      let firstTimer: ReturnType<typeof setTimeout> | undefined;
      let lastActivity: number | undefined;
      try {
        release = await acquire(budget.signal);
        firstTimer = setTimeout(() => controller.abort(), positiveEnv("AI_STREAM_FIRST_TIMEOUT_MS", 15_000));
        const res = await bounded(fetch(`${cfg.baseUrl}/chat/completions`, {
          ...jsonInit(cfg, { model: cfg.model, messages, stream: true, temperature: opts.temperature ?? 0.8, max_tokens: maxTokensFor(cfg, opts.maxTokens ?? 1200), ...thinking(cfg) }), signal,
        }), signal);
        assertOk(res);
        if (!res.body) throw new AiFailure("network", true);
        reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let complete = false;
        for (;;) {
          // 心跳、空delta、被拆开的字节不能续期；正文与推理内容共用响应活动计时。
          const idle = lastActivity === undefined ? undefined : setTimeout(() => controller.abort(),
            Math.max(0, positiveEnv("AI_STREAM_IDLE_TIMEOUT_MS", 15_000) - (Date.now() - lastActivity)));
          let chunk: ReadableStreamReadResult<Uint8Array>;
          try { chunk = await bounded(reader.read(), signal); }
          finally { clearTimeout(idle); }
          buf += chunk.done ? decoder.decode() + "\n" : decoder.decode(chunk.value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim().startsWith("data:")) continue;
            const payload = line.trim().slice(5).trim();
            if (payload === "[DONE]") { complete = true; break; }
            const data = JSON.parse(payload) as { error?: unknown; choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: string }> };
            if (data.error) throw new AiFailure("network", true);
            const choice = data.choices?.[0];
            if (choice?.finish_reason === "length" || choice?.finish_reason === "content_filter") throw new AiFailure("bad_json");
            const reasoning = choice?.delta?.reasoning_content;
            const delta = choice?.delta?.content;
            if ((typeof reasoning === "string" && reasoning.length) || (typeof delta === "string" && delta.length)) {
              lastActivity = Date.now();
              clearTimeout(firstTimer);
            }
            if (typeof delta === "string" && delta.length) {
              emitted = true;
              yield delta;
            }
          }
          if (complete) break;
          if (chunk.done) throw new AiFailure("network", true);
        }
        if (!emitted) throw new AiFailure("bad_json");
        break;
      } catch (error) {
        failure = failureOf(error);
        if (emitted || !failure.retryable || attempt >= 2 || budget.signal.aborted) break;
      } finally {
        clearTimeout(firstTimer);
        controller.abort();
        void reader?.cancel().catch(() => {});
        release?.();
      }
      failure = undefined;
      await backoff(attempt, budget.signal);
    }
  } catch (error) { failure = failureOf(error); }
  finally { budget.dispose(); }
  if (failure) {
    console.warn(`[ai.stream] ${emitted ? "interrupted" : "fallback"} ${failure.reason}`);
    if (emitted) {
      const info = execution("remote", started, cfg.model, failure.reason);
      // 部分文字已输出但本次失败，在体检中算fallback；原流协议保留remote中断语义。
      recordAiExecution("chat", { ...info, mode: "fallback" }, opts.purpose);
      opts.onExecution?.(info);
      throw new ChatStreamError(failure.reason, failure.retryable, info);
    }
    yield* fakeStream(opts.mock());
    report(execution("fallback", started, cfg.model, failure.reason));
  } else report(execution("remote", started, cfg.model));
}
async function* fakeStream(text: string): AsyncGenerator<string> {
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += 2) {
    await new Promise((r) => setTimeout(r, 16));
    yield chars.slice(i, i + 2).join("");
  }
}
export async function describeImage(dataUrl: string, hint: string, opts: CallOptions = {}): Promise<string | null> {
  return run("vision", roleConfig("vision"), opts, (cfg, budget) => requestJson(`${cfg.baseUrl}/chat/completions`, jsonInit(cfg, {
    model: cfg.model, max_tokens: maxTokensFor(cfg, 400), ...thinking(cfg), messages: [{ role: "user", content: [
      { type: "text", text: `请用 2-3 句中文客观描述这张生活照片：场景、人物、天气/光线、氛围与可能的地点线索。不要臆测人名。${hint ? `用户补充：${hint}` : ""}` },
      { type: "image_url", image_url: { url: dataUrl } },
    ] }],
  }), budget, content), () => null);
}
export async function embed(texts: string[], opts: CallOptions = {}): Promise<Float32Array[]> {
  const cfg = process.env.EMBED_MODE === "api" && texts.length ? roleConfig("embed") : null;
  return run("embed", cfg, opts, (c, budget) => requestJson(`${c.baseUrl}/embeddings`, jsonInit(c, { model: c.model, input: texts }), budget, (data) => {
    const rows = (data as { data?: Array<{ index: number; embedding: number[] }> })?.data;
    if (!Array.isArray(rows) || rows.length !== texts.length) throw new AiFailure("bad_json");
    const sorted = [...rows].sort((a, b) => a.index - b.index);
    const dimension = sorted[0]?.embedding?.length;
    return sorted.map((row, i) => {
      if (row.index !== i || !Array.isArray(row.embedding) || !dimension || row.embedding.length !== dimension || !row.embedding.every(Number.isFinite)) throw new AiFailure("bad_json");
      const vec = Float32Array.from(row.embedding);
      const norm = Math.sqrt(vec.reduce((sum, x) => sum + x * x, 0));
      if (!Number.isFinite(norm) || norm === 0) throw new AiFailure("bad_json");
      return vec.map((x) => x / norm);
    });
  }), () => texts.map(embedLite));
}
export async function transcribe(file: Blob, filename: string, opts: CallOptions = {}): Promise<string | null> {
  return run("asr", roleConfig("asr"), opts, (cfg, budget) => {
    const form = new FormData();
    form.append("file", file, filename);
    form.append("model", cfg.model);
    return requestJson(`${cfg.baseUrl}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${cfg.apiKey}` }, body: form }, budget, (data) => {
      const text = (data as { text?: unknown })?.text;
      if (typeof text !== "string" || !text.trim()) throw new AiFailure("bad_json");
      return text.trim();
    });
  }, () => null);
}

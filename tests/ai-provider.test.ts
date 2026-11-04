import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { chat, chatStream, ChatStreamError, describeImage, embed, roleConfig, transcribe } from "@/lib/ai/provider";
import { chatJson } from "@/lib/ai/json";
import type { ExecutionInfo } from "@/lib/types";

const messages = [{ role: "user" as const, content: "测试日记" }];
const mock = () => "本地回答";
const reply = (text = "远程回答") => Response.json({ choices: [{ message: { content: text }, finish_reason: "stop" }] });
const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const collect = async (stream: AsyncGenerator<string>) => { let text = ""; for await (const part of stream) text += part; return text; };
const delayed = <T>(value: T, ms: number) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("CHAT_API_KEY", "test-only-placeholder");
  vi.stubEnv("CHAT_BASE_URL", "https://api.deepseek.com/v1");
  vi.stubEnv("CHAT_MODEL", "deepseek-flash");
  vi.stubEnv("CHAT_THINKING", "off");
  vi.stubEnv("AI_TIMEOUT_MS", "1000");
  vi.stubEnv("CHAT_TIMEOUT_MS", "1000");
  vi.stubEnv("AI_RETRY_BASE_MS", "10");
  vi.stubEnv("AI_MAX_CONCURRENCY", "3");
  vi.stubEnv("AI_STREAM_TOTAL_TIMEOUT_MS", "1000");
  vi.stubEnv("AI_STREAM_FIRST_TIMEOUT_MS", "50");
  vi.stubEnv("AI_STREAM_IDLE_TIMEOUT_MS", "50");
  for (const role of ["VISION", "ASR", "EMBED"]) {
    vi.stubEnv(`${role}_API_KEY`, "");
    vi.stubEnv(`${role}_TIMEOUT_MS`, "1000");
  }
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("unexpected fetch"))));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fakeFetch(fn: (...args: Parameters<typeof fetch>) => Promise<Response>) {
  const fetcher = vi.fn(fn);
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
function configure(role: string) {
  vi.stubEnv(`${role}_API_KEY`, "test-only-placeholder");
  vi.stubEnv(`${role}_BASE_URL`, "https://compatible.example/v1");
  vi.stubEnv(`${role}_MODEL`, "test-model");
}

describe("Provider budgets, retries and execution", () => {
  it("未配置仍返回原Mock，并只回调一次", async () => {
    vi.stubEnv("CHAT_API_KEY", "");
    const onExecution = vi.fn();
    expect(await chat(messages, { mock, onExecution })).toBe(mock());
    expect(onExecution).toHaveBeenCalledExactlyOnceWith({ mode: "mock", durationMs: 0, fallbackReason: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("默认官方模型且思考关闭，on只作用于官方域名", async () => {
    const fetcher = fakeFetch(async () => reply());
    vi.stubEnv("CHAT_MODEL", "");
    expect(roleConfig("chat")?.model).toBe("deepseek-flash");
    await chat(messages, { mock });
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).thinking).toEqual({ type: "disabled" });
    vi.stubEnv("CHAT_THINKING", "on");
    await chat(messages, { mock });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).thinking).toEqual({ type: "enabled" });
    vi.stubEnv("CHAT_BASE_URL", "https://compatible.example/v1");
    await chat(messages, { mock });
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).not.toHaveProperty("thinking");
  });
  it("fetch超时会中止请求，完整预算不因重试重置", async () => {
    let signal: AbortSignal | undefined;
    const fetcher = fakeFetch(async (_url, init) => { signal = init?.signal as AbortSignal; return new Promise(() => {}); });
    const onExecution = vi.fn();
    const result = chat(messages, { mock, timeoutMs: 40, onExecution });
    await vi.advanceTimersByTimeAsync(40);
    expect(await result).toBe(mock());
    expect(signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onExecution.mock.calls[0][0]).toMatchObject({ mode: "fallback", fallbackReason: "timeout", durationMs: 40 });
  });
  it("已收到HTTP头但body挂起同样受总预算约束", async () => {
    fakeFetch(async () => new Response(new ReadableStream()));
    const onExecution = vi.fn();
    const result = chat(messages, { mock, timeoutMs: 30, onExecution });
    await vi.advanceTimersByTimeAsync(30);
    expect(await result).toBe(mock());
    expect(onExecution.mock.calls[0][0].fallbackReason).toBe("timeout");
  });
  it("429退避一次后成功，仍为remote且耗时包含退避", async () => {
    let n = 0;
    const fetcher = fakeFetch(async () => ++n === 1 ? new Response(null, { status: 429 }) : reply());
    const onExecution = vi.fn();
    const result = chat(messages, { mock, onExecution });
    await vi.advanceTimersByTimeAsync(9);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe("远程回答");
    expect(onExecution.mock.calls[0][0]).toMatchObject({ mode: "remote", durationMs: 10 });
  });
  it("5xx最多三次请求，耗尽后降级", async () => {
    const fetcher = fakeFetch(async () => new Response("provider secret body", { status: 503 }));
    const onExecution = vi.fn();
    const result = chat(messages, { mock, onExecution });
    await vi.runAllTimersAsync();
    expect(await result).toBe(mock());
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(onExecution.mock.calls[0][0]).toMatchObject({ mode: "fallback", fallbackReason: "http_5xx", durationMs: 30 });
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("[ai.chat] fallback http_5xx");
  });
  it("网络错误可重试", async () => {
    let n = 0;
    const fetcher = fakeFetch(async () => { if (++n === 1) throw new TypeError("connection failed"); return reply(); });
    const result = chat(messages, { mock });
    await vi.runAllTimersAsync();
    expect(await result).toBe("远程回答");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it.each([400, 401, 403, 404])("HTTP %i 不重试且日志不含错误正文", async (status) => {
    const fetcher = fakeFetch(async () => new Response("SECRET", { status }));
    const onExecution = vi.fn();
    expect(await chat(messages, { mock, onExecution })).toBe(mock());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onExecution.mock.calls[0][0].fallbackReason).toBe(`http_${status}`);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("SECRET");
  });
  it("跨chat/vision/ASR/embed共享并发上限", async () => {
    vi.stubEnv("AI_MAX_CONCURRENCY", "2");
    configure("VISION"); configure("ASR"); configure("EMBED"); vi.stubEnv("EMBED_MODE", "api");
    let active = 0; let peak = 0;
    const fetcher = fakeFetch(async (url) => {
      active++; peak = Math.max(peak, active);
      await delayed(null, 20); active--;
      return String(url).endsWith("/embeddings") ? Response.json({ data: [{ index: 0, embedding: [1, 0] }] }) :
        String(url).endsWith("/transcriptions") ? Response.json({ text: "语音" }) : reply();
    });
    const result = Promise.all([chat(messages, { mock }), describeImage("data:image/png;base64,AA==", ""), transcribe(new Blob(["a"]), "a.wav"), embed(["记忆"]), chat(messages, { mock })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await vi.runAllTimersAsync();
    await result;
    expect(peak).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("排队也计入总超时，超时任务不再发请求且队列可继续使用", async () => {
    vi.stubEnv("AI_MAX_CONCURRENCY", "1");
    const fetcher = fakeFetch(async () => delayed(reply(), 50));
    const first = chat(messages, { mock });
    const onExecution = vi.fn();
    const second = chat(messages, { mock, timeoutMs: 20, onExecution });
    await vi.advanceTimersByTimeAsync(20);
    expect(await second).toBe(mock());
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30);
    expect(await first).toBe("远程回答");
    const third = chat(messages, { mock });
    await vi.runAllTimersAsync();
    expect(await third).toBe("远程回答");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("ASR和向量都有超时与执行信息", async () => {
    configure("ASR"); configure("EMBED"); vi.stubEnv("EMBED_MODE", "api");
    fakeFetch(async () => new Promise(() => {}));
    const a = vi.fn(); const b = vi.fn();
    const result = Promise.all([transcribe(new Blob(["a"]), "a.wav", { timeoutMs: 20, onExecution: a }), embed(["文字"], { timeoutMs: 20, onExecution: b })]);
    await vi.advanceTimersByTimeAsync(20);
    const [asr, vectors] = await result;
    expect(asr).toBeNull(); expect(vectors[0]).toHaveLength(512);
    for (const callback of [a, b]) expect(callback.mock.calls[0][0]).toMatchObject({ mode: "fallback", fallbackReason: "timeout" });
  });
  it("调用方回调异常不会被吞掉或二次调用", async () => {
    fakeFetch(async () => reply());
    const onExecution = vi.fn(() => { throw new Error("consumer bug"); });
    await expect(chat(messages, { mock, onExecution })).rejects.toThrow("consumer bug");
    expect(onExecution).toHaveBeenCalledTimes(1);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("stream lifecycle", () => {
  it("跨chunk的data行和无末尾换行的DONE正确解析", async () => {
    const bytes = new TextEncoder().encode(delta("你好") + "data: [DONE]");
    fakeFetch(async () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 7)); c.enqueue(bytes.slice(7)); c.close(); } })));
    const onExecution = vi.fn();
    expect(await collect(chatStream(messages, { mock, onExecution }))).toBe("你好");
    expect(onExecution.mock.calls[0][0].mode).toBe("remote");
  });
  it("HTTP头到达但首段内容一直不来，会有限重试再降级", async () => {
    const fetcher = fakeFetch(async () => new Response(new ReadableStream()));
    const onExecution = vi.fn();
    const result = collect(chatStream(messages, { mock, onExecution }));
    await vi.runAllTimersAsync();
    expect(await result).toBe(mock());
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(onExecution.mock.calls[0][0]).toMatchObject({ mode: "fallback", fallbackReason: "timeout" });
  });
  it("首包超时重试后成功不残留失败状态", async () => {
    let n = 0;
    fakeFetch(async () => ++n === 1 ? new Response(new ReadableStream()) : new Response(delta("成功") + "data: [DONE]\n\n"));
    const onExecution = vi.fn();
    const result = collect(chatStream(messages, { mock, onExecution }));
    await vi.runAllTimersAsync();
    expect(await result).toBe("成功");
    expect(onExecution.mock.calls[0][0].mode).toBe("remote");
  });
  it("输出后空闲超时不重试、不拼接Mock", async () => {
    const fetcher = fakeFetch(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(delta("半句"))); } })));
    const fallback = vi.fn(mock);
    const stream = chatStream(messages, { mock: fallback });
    expect((await stream.next()).value).toBe("半句");
    const result = stream.next().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBeInstanceOf(ChatStreamError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });
  it("思考模式：推理内容不输出，但算作有响应，不触发首包/空闲超时", async () => {
    vi.stubEnv("CHAT_THINKING", "on");
    const think = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: text } }] })}\n\n`;
    const enc = new TextEncoder();
    const fetcher = fakeFetch(async () => new Response(new ReadableStream({
      async start(c) {
        // 推理持续 120ms，远超 50ms 的首包超时，但每 30ms 都有推理片段
        for (let i = 0; i < 4; i++) { c.enqueue(enc.encode(think("想一想"))); await delayed(null, 30); }
        c.enqueue(enc.encode(delta("正文") + "data: [DONE]\n\n"));
        c.close();
      },
    })));
    const onExecution = vi.fn();
    const result = collect(chatStream(messages, { mock, onExecution, maxTokens: 300 }));
    await vi.runAllTimersAsync();
    expect(await result).toBe("正文");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onExecution.mock.calls[0][0].mode).toBe("remote");
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.max_tokens).toBe(300 + 4000);
  });
  it("思考模式只对官方域名追加推理预算；默认 base_url 与官方文档一致", async () => {
    vi.stubEnv("CHAT_THINKING", "on");
    vi.stubEnv("CHAT_BASE_URL", "");
    expect(roleConfig("chat")?.baseUrl).toBe("https://api.deepseek.com");
    const fetcher = fakeFetch(async () => reply());
    await chat(messages, { mock, maxTokens: 200 });
    expect(String(fetcher.mock.calls[0][0])).toBe("https://api.deepseek.com/chat/completions");
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).max_tokens).toBe(4200);
    vi.stubEnv("CHAT_BASE_URL", "https://compatible.example/v1");
    await chat(messages, { mock, maxTokens: 200 });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).max_tokens).toBe(200);
  });
  it("提前EOF不作为成功，消费方return会释放并发槽", async () => {
    vi.stubEnv("AI_MAX_CONCURRENCY", "1");
    fakeFetch(async () => new Response(delta("半句")));
    const stream = chatStream(messages, { mock });
    await stream.next();
    await expect(stream.next()).rejects.toBeInstanceOf(ChatStreamError);
    const next = chatStream(messages, { mock });
    expect((await next.next()).value).toBe("半句");
    await next.return("");
    fakeFetch(async () => reply());
    expect(await chat(messages, { mock })).toBe("远程回答");
  });
});

describe("JSON repair budget", () => {
  const schema = z.object({ title: z.string() });
  const local = () => ({ title: "本地标题" });
  it("格式错误独立修复，最终只回调一次", async () => {
    let n = 0;
    const fetcher = fakeFetch(async () => reply(++n === 1 ? "invalid" : '{"title":"远程标题"}'));
    const onExecution = vi.fn();
    expect(await chatJson(schema, messages, { mock: local, onExecution })).toEqual({ title: "远程标题" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onExecution).toHaveBeenCalledTimes(1);
    expect(onExecution.mock.calls[0][0].mode).toBe("remote");
  });
  it("被max_tokens截断的JSON进入修复，而不是直接降级", async () => {
    let n = 0;
    const fetcher = fakeFetch(async () => ++n === 1
      ? Response.json({ choices: [{ message: { content: '{"title":"远程' }, finish_reason: "length" }] })
      : reply('{"title":"远程标题"}'));
    const onExecution = vi.fn();
    expect(await chatJson(schema, messages, { mock: local, onExecution })).toEqual({ title: "远程标题" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(onExecution.mock.calls[0][0].mode).toBe("remote");
    const repair = JSON.parse(String(fetcher.mock.calls[1][1]?.body)).messages.at(-1).content;
    expect(repair).toContain("截断");
  });
  it("修复提示带上zod的约束说明", async () => {
    const fetcher = fakeFetch(async () => reply('{"title":123}'));
    await chatJson(schema, messages, { mock: local, retries: 1 });
    const repair = JSON.parse(String(fetcher.mock.calls[1][1]?.body)).messages.at(-1).content;
    expect(repair).toMatch(/title: Expected string/);
  });
  it("普通chat仍把截断当作失败降级", async () => {
    fakeFetch(async () => Response.json({ choices: [{ message: { content: "半封信" }, finish_reason: "length" }] }));
    const onExecution = vi.fn();
    expect(await chat(messages, { mock, onExecution })).toBe(mock());
    expect(onExecution.mock.calls[0][0]).toMatchObject({ mode: "fallback", fallbackReason: "bad_json" });
  });
  it("修复耗尽返回bad_json而不是假装remote", async () => {
    const fetcher = fakeFetch(async () => reply('{"title":123}'));
    const onExecution = vi.fn();
    expect(await chatJson(schema, messages, { mock: local, onExecution })).toEqual(local());
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(onExecution.mock.calls[0][0]).toMatchObject({ mode: "fallback", fallbackReason: "bad_json" });
  });
  it("网络重试耗尽后不会再启动JSON重试", async () => {
    const fetcher = fakeFetch(async () => new Response(null, { status: 503 }));
    const result = chatJson(schema, messages, { mock: local });
    await vi.runAllTimersAsync();
    expect(await result).toEqual(local());
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("修复和网络请求共享总预算", async () => {
    fakeFetch(async () => delayed(reply("invalid"), 30));
    let info: ExecutionInfo | undefined;
    const result = chatJson(schema, messages, { mock: local, timeoutMs: 50, onExecution: (value) => { info = value; } });
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toEqual(local());
    expect(info).toMatchObject({ mode: "fallback", fallbackReason: "timeout", durationMs: 50 });
    await vi.runAllTimersAsync();
  });
});

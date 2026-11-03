import { afterEach, describe, expect, it, vi } from "vitest";
import { postSSE } from "@/lib/sse";
import { sseResponse } from "@/lib/server-sse";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("POST SSE client", () => {
  it("支持分块CRLF、多行data、额外headers，并兼容非JSON数据", async () => {
    const bytes = new TextEncoder().encode('event: meta\r\ndata: {\r\ndata: "name":"小林"}\r\n\r\nevent: delta\ndata: text\n\n');
    const fetcher = vi.fn(async () => new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } })));
    vi.stubGlobal("fetch", fetcher);
    const on = vi.fn();
    await postSSE("/url", {}, on, { headers: { Accept: "text/event-stream" } });
    expect(on.mock.calls).toEqual([["meta", { name: "小林" }], ["delta", "text"]]);
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(new Headers(init.headers).get("Accept")).toBe("text/event-stream");
  });
  it("业务回调抛错只执行一次并取消reader", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('event: delta\ndata: "a"\n\n')); }, cancel })));
    const on = vi.fn(() => { throw new Error("callback failed"); });
    await expect(postSSE("/url", {}, on)).rejects.toThrow("callback failed");
    expect(on).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("AbortSignal中止等待中的read且不再派发事件", async () => {
    const controller = new AbortController();
    const cancel = vi.fn();
    vi.stubGlobal("fetch", async () => new Response(new ReadableStream({ cancel })));
    const on = vi.fn();
    const task = postSSE("/url", {}, on, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(task).rejects.toMatchObject({ name: "AbortError" });
    expect(on).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
  });
  it("服务端15秒心跳，断连后清理订阅", async () => {
    vi.useFakeTimers();
    const detach = vi.fn();
    const response = sseResponse(new AbortController().signal, () => detach);
    const reader = response.body!.getReader();
    const pending = reader.read();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(new TextDecoder().decode((await pending).value)).toContain("event: heartbeat");
    await reader.cancel();
    expect(detach).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

export interface SSEWriter {
  readonly closed: boolean;
  send(event: string, data: unknown): void;
  close(): void;
}

/** 连接生命周期独立于业务任务；断连只清理订阅、计时器和监听。 */
export function sseResponse(signal: AbortSignal, attach: (writer: SSEWriter) => (() => void) | void): Response {
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const lifecycle: { detach?: (() => void) | void; timer?: ReturnType<typeof setInterval> } = {};
      const encoder = new TextEncoder();
      const writer: SSEWriter = {
        get closed() { return closed; },
        send(event, data) {
          if (closed) return;
          try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); }
          catch { writer.close(); }
        },
        close() {
          if (closed) return;
          closed = true;
          clearInterval(lifecycle.timer);
          signal.removeEventListener("abort", writer.close);
          lifecycle.detach?.();
          try { controller.close(); } catch { /* 已被客户端取消 */ }
        },
      };
      cleanup = writer.close;
      if (signal.aborted) { writer.close(); return; }
      signal.addEventListener("abort", writer.close, { once: true });
      lifecycle.timer = setInterval(() => writer.send("heartbeat", {}), 15_000);
      lifecycle.detach = attach(writer);
      if (closed) lifecycle.detach?.();
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
  } });
}

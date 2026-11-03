/** 流开始前的 HTTP 失败：保留通用错误体的 code，前端据此区分「占用」「已达上限」等情况。 */
export class SSEHttpError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string, public readonly retryable = false) {
    super(message);
    this.name = "SSEHttpError";
  }
}

/** 浏览器端 SSE（POST）；第四个可选参数兼容原来的三个参数调用。 */
export async function postSSE(
  url: string,
  body: unknown,
  on: (event: string, data: unknown) => void,
  options: { signal?: AbortSignal; headers?: HeadersInit } = {},
) {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: options.signal });
  if (!res.ok || !res.body) {
    const error = await res.json().catch(() => null) as { error?: string; code?: string; retryable?: boolean } | null;
    throw new SSEHttpError(error?.error ?? `请求失败 ${res.status}`, res.status, error?.code, error?.retryable ?? false);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let event = "message";
  let data: string[] = [];
  const line = (value: string) => {
    if (!value) {
      if (data.length) {
        const raw = data.join("\n");
        let parsed: unknown = raw;
        try { parsed = JSON.parse(raw); } catch { /* 非 JSON 载荷仍兼容 */ }
        on(event, parsed); // 业务异常必须原样抛出，不能再次调用。
      }
      event = "message";
      data = [];
    } else if (value.startsWith("event:")) event = value.slice(6).trim();
    else if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /, ""));
  };
  const abort = () => { void reader.cancel().catch(() => {}); };
  options.signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      options.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      options.signal?.throwIfAborted();
      buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buf.indexOf("\n")) >= 0) {
        line(buf.slice(0, index).replace(/\r$/, ""));
        buf = buf.slice(index + 1);
      }
      if (done) break;
    }
  } finally {
    options.signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

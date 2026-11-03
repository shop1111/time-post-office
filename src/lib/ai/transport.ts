/** 一个调用的预算覆盖排队、退避和完整响应读取。仅供服务端使用。 */
export class AiFailure extends Error {
  constructor(public readonly reason: string, public readonly retryable = false) {
    super(reason);
    this.name = "AiFailure";
  }
}
export function positiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) || fallback : fallback;
}
export function failureOf(error: unknown): AiFailure {
  if (error instanceof AiFailure) return error;
  if (error instanceof SyntaxError) return new AiFailure("bad_json");
  if (error instanceof Error && /^(AbortError|TimeoutError)$/.test(error.name)) return new AiFailure("timeout", true);
  return new AiFailure("network", true);
}
export class Budget {
  readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout>;
  constructor(ms: number) { this.timer = setTimeout(() => this.controller.abort(), ms); }
  get signal() { return this.controller.signal; }
  dispose() { clearTimeout(this.timer); }
}
export function bounded<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void work.catch(() => {});
    return Promise.reject(new AiFailure("timeout", true));
  }
  return new Promise((resolve, reject) => {
    const abort = () => reject(new AiFailure("timeout", true));
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
let active = 0;
const queue: Array<() => void> = [];
function drain() {
  while (active < positiveEnv("AI_MAX_CONCURRENCY", 3) && queue.length) queue.shift()!();
}
export function acquire(signal: AbortSignal): Promise<() => void> {
  if (signal.aborted) return Promise.reject(new AiFailure("timeout", true));
  return new Promise((resolve, reject) => {
    const abort = () => {
      const index = queue.indexOf(grant);
      if (index >= 0) queue.splice(index, 1);
      reject(new AiFailure("timeout", true));
    };
    const grant = () => {
      signal.removeEventListener("abort", abort);
      active++;
      let released = false;
      resolve(() => { if (!released) { released = true; active--; drain(); } });
    };
    signal.addEventListener("abort", abort, { once: true });
    queue.push(grant);
    drain();
  });
}
export async function backoff(attempt: number, signal: AbortSignal) {
  const ms = positiveEnv("AI_RETRY_BASE_MS", 300) * 2 ** attempt * (0.75 + Math.random() * 0.5);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await bounded(new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); }), signal); }
  finally { clearTimeout(timer); }
}
export function assertOk(res: Response) {
  if (res.ok) return;
  void res.body?.cancel().catch(() => {});
  const reason = res.status === 429 ? "http_429" : res.status >= 500 ? "http_5xx" : `http_${res.status}`;
  throw new AiFailure(reason, res.status === 429 || res.status >= 500);
}
/** JSON与音频共用预算、并发槽和有限重试；读取正文也在预算内。 */
export async function requestResponse<T>(url: string, init: RequestInit, budget: Budget, decode: (response: Response) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    let release: (() => void) | undefined;
    try {
      release = await acquire(budget.signal);
      const res = await bounded(fetch(url, { ...init, signal: budget.signal }), budget.signal);
      assertOk(res);
      return await bounded(decode(res), budget.signal);
    } catch (error) {
      const failure = failureOf(error);
      if (!failure.retryable || attempt >= 2 || budget.signal.aborted) throw failure;
    } finally { release?.(); }
    await backoff(attempt, budget.signal);
  }
}

export function requestJson<T>(url: string, init: RequestInit, budget: Budget, decode: (data: unknown) => T): Promise<T> {
  return requestResponse(url, init, budget, async (res) => decode(await res.json()));
}

import { z } from "zod";
import { chat, callTimeout, roleConfig, type CallOptions, type ChatMessage } from "./provider";
import type { ExecutionInfo } from "@/lib/types";
import { reportJsonExecution } from "./execution";

/** 从模型输出中提取 JSON：容忍 ```json 代码块、前后废话、尾逗号、中文引号 */
export function extractJson(raw: string): unknown {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/[[{]/);
  if (start < 0) throw new Error("输出中没有 JSON");
  const close = s[start] === "{" ? "}" : "]";
  const end = s.lastIndexOf(close);
  if (end <= start) throw new Error("JSON 不完整");
  s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    const fixed = s.replace(/,\s*([}\]])/g, "$1").replace(/[“”]/g, '"');
    return JSON.parse(fixed);
  }
}

/**
 * 结构化输出：zod 校验，失败时把错误反馈给模型修复重试，最终兜底 mock。
 */
export async function chatJson<T extends z.ZodTypeAny>(
  schema: T,
  messages: ChatMessage[],
  opts: CallOptions & { mock: () => z.infer<T>; temperature?: number; maxTokens?: number; retries?: number },
): Promise<z.infer<T>> {
  const retries = Math.max(0, Math.min(2, Math.floor(opts.retries ?? 2)));
  const started = Date.now();
  const deadline = started + callTimeout("chat", opts);
  const finish = (value: z.infer<T>, info: ExecutionInfo) => {
    const execution = { ...info, durationMs: Date.now() - started };
    reportJsonExecution(execution);
    opts.onExecution?.(execution);
    return value;
  };
  const fallback = (reason: string) => {
    console.warn(`[ai.json] fallback ${reason}`);
    return finish(opts.mock(), { mode: "fallback", model: roleConfig("chat")?.model, durationMs: 0, fallbackReason: reason });
  };
  const history = [...messages];
  for (let attempt = 0; attempt <= retries; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return fallback("timeout");
    let info: ExecutionInfo | undefined;
    let local: z.infer<T> | undefined;
    const raw = await chat(history, {
      json: true,
      // 截断的 JSON 交给下面的修复循环处理，而不是直接降级到本地结果
      allowTruncated: true,
      temperature: opts.temperature ?? 0.4,
      maxTokens: opts.maxTokens,
      timeoutMs: remaining,
      onExecution: (value) => { info = value; },
      mock: () => { local = opts.mock(); return JSON.stringify(local); },
    });
    // 网络降级与JSON修复分别计数，网络已降级后不再重复请求模型。
    if (info!.mode !== "remote") return finish(local, info!);
    let parsed: z.infer<T>;
    try {
      parsed = schema.parse(extractJson(raw));
    } catch (e) {
      // 发给模型的是 zod 的约束说明（如「最多 160 个字符」），日志里仍只记次数，不记内容
      const msg = e instanceof z.ZodError
        ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
        : "JSON 不完整或格式无效，可能是输出过长被截断，请精简内容";
      console.warn(`[ai.json] repair ${attempt + 1} bad_json`);
      history.push({ role: "assistant", content: raw });
      history.push({ role: "user", content: `你的输出不符合要求（${msg}）。请只输出修正后的合法 JSON，不要任何解释。` });
      continue;
    }
    return finish(parsed, info!);
  }
  return fallback("bad_json");
}

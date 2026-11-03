import { z } from "zod";
import { chat, type ChatMessage } from "./provider";

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
  opts: { mock: () => z.infer<T>; temperature?: number; maxTokens?: number; retries?: number },
): Promise<z.infer<T>> {
  const retries = opts.retries ?? 2;
  const history = [...messages];
  for (let attempt = 0; attempt <= retries; attempt++) {
    const raw = await chat(history, {
      json: true,
      temperature: opts.temperature ?? 0.4,
      maxTokens: opts.maxTokens,
      mock: () => JSON.stringify(opts.mock()),
    });
    try {
      return schema.parse(extractJson(raw));
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : String(e);
      console.warn(`[ai.json] 第 ${attempt + 1} 次解析失败：${msg}`);
      history.push({ role: "assistant", content: raw });
      history.push({ role: "user", content: `你的输出不符合要求（${msg}）。请只输出修正后的合法 JSON，不要任何解释。` });
    }
  }
  return opts.mock();
}

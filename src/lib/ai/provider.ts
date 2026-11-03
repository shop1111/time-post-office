/**
 * 可插拔 AI Provider：按「角色」配置，全部走 OpenAI 兼容协议。
 *  - chat   对话 / 写信 / 抽取（默认 DeepSeek）
 *  - vision 看图（DeepSeek 官方 API 不支持图片，单独配置）
 *  - embed  向量（lite 本地 / api 远程）
 *  - asr    语音转写（不配置则走浏览器 Web Speech）
 * chat 未配置时整体进入 Mock 演示模式：每个调用点都提供自己的 mock 生成器。
 */
import { embedLite } from "@/lib/memory/embed-lite";

export type Role = "chat" | "vision" | "embed" | "asr";
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

interface RoleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function roleConfig(role: Role): RoleConfig | null {
  const p = role.toUpperCase();
  const baseUrl = process.env[`${p}_BASE_URL`]?.trim();
  const apiKey = process.env[`${p}_API_KEY`]?.trim();
  const model = process.env[`${p}_MODEL`]?.trim();
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model };
}

export const isMock = () => roleConfig("chat") === null;

export function providerStatus() {
  const embedCfg = process.env.EMBED_MODE === "api" ? roleConfig("embed") : null;
  return {
    mock: isMock(),
    chat: roleConfig("chat")?.model ?? null,
    vision: roleConfig("vision")?.model ?? null,
    embed: embedCfg ? embedCfg.model : "lite（本地 n-gram 哈希向量）",
    asr: roleConfig("asr")?.model ?? "浏览器 Web Speech API",
  };
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  /** Mock 模式（或请求失败）时返回的内容 */
  mock: () => string;
}

async function post(cfg: RoleConfig, path: string, body: unknown) {
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`AI 请求失败 ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

export async function chat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const cfg = roleConfig("chat");
  if (!cfg) return opts.mock();
  try {
    const res = await post(cfg, "/chat/completions", {
      model: cfg.model,
      messages,
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 1200,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    });
    const data = await res.json();
    return String(data.choices?.[0]?.message?.content ?? "");
  } catch (e) {
    console.error("[ai.chat] 失败，回退到 mock：", e);
    return opts.mock();
  }
}

/** 流式输出：逐段 yield 文本增量 */
export async function* chatStream(messages: ChatMessage[], opts: ChatOptions): AsyncGenerator<string> {
  const cfg = roleConfig("chat");
  if (!cfg) {
    yield* fakeStream(opts.mock());
    return;
  }
  let res: Response;
  try {
    res = await post(cfg, "/chat/completions", {
      model: cfg.model,
      messages,
      stream: true,
      temperature: opts.temperature ?? 0.8,
      max_tokens: opts.maxTokens ?? 1200,
    });
  } catch (e) {
    console.error("[ai.stream] 失败，回退到 mock：", e);
    yield* fakeStream(opts.mock());
    return;
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch {
        /* 忽略不完整的行 */
      }
    }
  }
}

async function* fakeStream(text: string): AsyncGenerator<string> {
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += 2) {
    await new Promise((r) => setTimeout(r, 16));
    yield chars.slice(i, i + 2).join("");
  }
}

/** 看图：返回中文描述；未配置视觉模型返回 null（由 EXIF + 用户描述兜底） */
export async function describeImage(dataUrl: string, hint: string): Promise<string | null> {
  const cfg = roleConfig("vision");
  if (!cfg) return null;
  try {
    const res = await post(cfg, "/chat/completions", {
      model: cfg.model,
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `请用 2-3 句中文客观描述这张生活照片：场景、人物、天气/光线、氛围与可能的地点线索。不要臆测人名。${hint ? `用户补充：${hint}` : ""}`,
            },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });
    const data = await res.json();
    return String(data.choices?.[0]?.message?.content ?? "").trim() || null;
  } catch (e) {
    console.error("[ai.vision] 失败：", e);
    return null;
  }
}

/** 向量：EMBED_MODE=api 时走远程，否则本地 lite 向量 */
export async function embed(texts: string[]): Promise<Float32Array[]> {
  const cfg = process.env.EMBED_MODE === "api" ? roleConfig("embed") : null;
  if (cfg && texts.length) {
    try {
      const res = await post(cfg, "/embeddings", { model: cfg.model, input: texts });
      const data = await res.json();
      return (data.data as Array<{ embedding: number[] }>).map((d) => normalize(Float32Array.from(d.embedding)));
    } catch (e) {
      console.error("[ai.embed] 远程失败，回退 lite：", e);
    }
  }
  return texts.map(embedLite);
}

function normalize(v: Float32Array) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/** 服务端语音转写（可选） */
export async function transcribe(file: Blob, filename: string): Promise<string | null> {
  const cfg = roleConfig("asr");
  if (!cfg) return null;
  const form = new FormData();
  form.append("file", file, filename);
  form.append("model", cfg.model);
  try {
    const res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const data = await res.json();
    return String(data.text ?? "").trim() || null;
  } catch (e) {
    console.error("[ai.asr] 失败：", e);
    return null;
  }
}

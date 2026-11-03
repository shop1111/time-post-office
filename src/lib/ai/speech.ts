import { AiFailure, bounded, Budget, failureOf, positiveEnv, requestResponse } from "./transport";
import type { ExecutionInfo } from "@/lib/types";
import { recordAiExecution } from "./telemetry";

export interface SpeechConfig { baseUrl: string; apiKey: string; model: string; voice: string }
export function speechConfig(): SpeechConfig | null {
  const baseUrl = process.env.TTS_BASE_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.TTS_API_KEY?.trim(), model = process.env.TTS_MODEL?.trim(), voice = process.env.TTS_VOICE?.trim();
  return baseUrl && apiKey && model && voice ? { baseUrl, apiKey, model, voice } : null;
}
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
async function readMp3(response: Response, signal: AbortSignal) {
  if (!response.body || /(?:json|text\/)/i.test(response.headers.get("content-type") ?? "") || Number(response.headers.get("content-length")) > MAX_AUDIO_BYTES) {
    void response.body?.cancel().catch(() => {});
    throw new AiFailure("bad_audio");
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await bounded(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) throw new AiFailure("audio_too_large");
      chunks.push(Buffer.from(value));
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
  const audio = Buffer.concat(chunks);
  // 拒绝空响应、JSON或HTML伪装的成功结果；不把错误正文写成mp3。
  if (audio.length < 10 || !(audio.subarray(0, 3).toString() === "ID3" || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0))) throw new AiFailure("bad_audio");
  return audio;
}

/** 没有Mock分支；配置检查与HTTP错误映射由speech业务层负责。 */
export async function synthesizeSpeech(text: string, config: SpeechConfig): Promise<{ audio: Buffer; execution: ExecutionInfo }> {
  const started = Date.now();
  const budget = new Budget(positiveEnv("TTS_TIMEOUT_MS", positiveEnv("AI_TIMEOUT_MS", 45_000)));
  try {
    const audio = await requestResponse(`${config.baseUrl}/audio/speech`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, voice: config.voice, input: text, response_format: "mp3" }),
    }, budget, (response) => readMp3(response, budget.signal));
    const execution: ExecutionInfo = { mode: "remote", model: config.model, durationMs: Date.now() - started };
    recordAiExecution("tts", execution, "tts");
    return { audio, execution };
  } catch (error) {
    recordAiExecution("tts", { mode: "fallback", model: config.model, durationMs: Date.now() - started, fallbackReason: failureOf(error).reason }, "tts");
    throw error;
  } finally { budget.dispose(); }
}

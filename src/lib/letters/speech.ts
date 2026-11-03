import { createHash, randomBytes } from "node:crypto";
import { mkdir, stat, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { UPLOAD_DIR } from "@/lib/files";
import { speechConfig, synthesizeSpeech } from "@/lib/ai/speech";
import type { ExecutionInfo } from "@/lib/types";
import { logError } from "@/lib/errors";
import { recordAiExecution } from "@/lib/ai/telemetry";

interface SpeechResult { url: string; cached: boolean; execution: ExecutionInfo }
export class SpeechRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly retryable = false) { super(message); }
}
const globals = globalThis as unknown as { speechRuns?: Map<string, Promise<SpeechResult>> };
const runs = globals.speechRuns ??= new Map<string, Promise<SpeechResult>>();
// 当前写信正文最多1500字符。较长的旧信/手写信不截断，交给浏览器朗读。
export const MAX_SPEECH_CHARACTERS = 4000;
export async function letterSpeech(letterId: string): Promise<SpeechResult> {
  const started = Date.now();
  const letter = await db.letter.findUnique({ where: { id: letterId }, select: { id: true, body: true } });
  if (!letter) throw new SpeechRequestError(404, "LETTER_NOT_FOUND", "找不到这封信");
  const config = speechConfig();
  if (!config) {
    recordAiExecution("tts", { mode: "mock", durationMs: Date.now() - started, fallbackReason: "not_configured" }, "tts");
    throw new SpeechRequestError(501, "TTS_NOT_CONFIGURED", "尚未配置朗读服务，请使用浏览器朗读");
  }
  if (!letter.body.trim()) throw new SpeechRequestError(400, "TTS_EMPTY_TEXT", "信件没有可朗读的正文");
  if (letter.body.length > MAX_SPEECH_CHARACTERS) throw new SpeechRequestError(400, "TTS_TEXT_TOO_LONG", "正文超过4000字符，请使用浏览器朗读完整信件");
  // 加入端点和格式版本，防止切换服务商后误用旧音色；绝不把Key写入文件名或元数据。
  const key = createHash("sha256").update(JSON.stringify([letter.id, letter.body, config.baseUrl, config.model, config.voice, "mp3-v1"])).digest("hex");
  const name = `speech-${key}.mp3`, file = path.join(UPLOAD_DIR, name), url = `/api/files/${name}`;
  const cached = (): SpeechResult => ({ url, cached: true, execution: { mode: "remote", model: config.model, durationMs: Date.now() - started } });
  const pending = runs.get(key);
  if (pending) { await pending; return cached(); }
  const run = (async (): Promise<SpeechResult> => {
    try { const existing = await stat(file); if (existing.isFile() && existing.size > 0) return cached(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const { audio, execution } = await synthesizeSpeech(letter.body, config);
    await mkdir(UPLOAD_DIR, { recursive: true });
    const temporary = `${file}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      await writeFile(temporary, audio, { flag: "wx" });
      await rename(temporary, file); // 完整写好才发布缓存，读者永远看不到半个音频。
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") logError("speech.cleanup", error); });
    }
    return { url, cached: false, execution: { ...execution, durationMs: Date.now() - started } };
  })();
  runs.set(key, run);
  try { return await run; } finally { if (runs.get(key) === run) runs.delete(key); }
}

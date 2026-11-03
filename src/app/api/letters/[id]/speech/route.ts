import { letterSpeech, SpeechRequestError } from "@/lib/letters/speech";
import { logError } from "@/lib/errors";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await letterSpeech((await params).id)); }
  catch (error) {
    if (error instanceof SpeechRequestError) return Response.json({ error: error.message, code: error.code, retryable: error.retryable } satisfies ApiError, { status: error.status });
    logError("letter.speech", error);
    return Response.json({ error: "朗读服务暂时不可用，请稍后重试或使用浏览器朗读", code: "TTS_FAILED", retryable: true } satisfies ApiError, { status: 502 });
  }
}

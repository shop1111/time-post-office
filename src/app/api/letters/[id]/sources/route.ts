import { letterSources } from "@/lib/letters/sources";
import { logError } from "@/lib/errors";
import type { ApiError } from "@/lib/types";
export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await letterSources((await params).id);
    return result ? Response.json(result) : Response.json({ error: "找不到这封信", code: "LETTER_NOT_FOUND", retryable: false } satisfies ApiError, { status: 404 });
  } catch (error) {
    logError("letter.sources", error);
    return Response.json({ error: "出处暂时无法读取，请稍后重试", code: "LETTER_SOURCES_FAILED", retryable: true } satisfies ApiError, { status: 500 });
  }
}

import { getFinalizeStatus, JobRequestError, startFinalize, subscribeFinalize } from "@/lib/jobs";
import { sseResponse } from "@/lib/server-sse";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
const failure = (error: unknown) => {
  const known = error instanceof JobRequestError;
  return Response.json({
    error: known ? error.message : "收进邮局暂时失败，请稍后重试",
    code: known ? error.code : "FINALIZE_FAILED", retryable: known ? error.retryable : true,
  } satisfies ApiError, { status: known ? error.status : 500 });
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // 任务不持有 req.signal，客户端断连只退订 SSE，后台照常完成。
    const { run, reused } = await startFinalize(id);
    if (req.headers.get("Accept")?.includes("text/event-stream")) {
      return sseResponse(req.signal, (writer) => subscribeFinalize(run, reused, writer));
    }
    const state = await run.done;
    if (state.status === "completed" || state.status === "partial") return Response.json(state.result);
    return Response.json({ error: state.error?.message ?? "收进邮局失败", code: state.error?.code ?? "FINALIZE_FAILED", retryable: state.error?.retryable ?? true } satisfies ApiError, { status: 500 });
  } catch (error) { return failure(error); }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try { return Response.json(await getFinalizeStatus((await params).id)); }
  catch (error) { return failure(error); }
}

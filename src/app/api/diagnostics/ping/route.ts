import { pingCapability, PingRateLimitError } from "@/lib/diagnostics";
import { logError } from "@/lib/errors";
import type { ApiError } from "@/lib/types";
export const runtime = "nodejs";
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || (body.role !== "chat" && body.role !== "embed")) return Response.json({ error: "仅支持chat或embed体检", code: "INVALID_PING_ROLE", retryable: false } satisfies ApiError, { status: 400 });
  try { return Response.json(await pingCapability(body.role), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    if (error instanceof PingRateLimitError) return Response.json({ error: "同一能力请间隔5秒再试", code: "PING_RATE_LIMITED", retryable: true } satisfies ApiError, { status: 429, headers: { "Retry-After": "5" } });
    logError("diagnostics.ping", error);
    return Response.json({ error: "体检暂时失败，请稍后重试", code: "PING_FAILED", retryable: true } satisfies ApiError, { status: 500 });
  }
}

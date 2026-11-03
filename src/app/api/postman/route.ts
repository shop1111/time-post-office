import { runPostmanAction } from "@/lib/postman/actions";
import { sseResponse, type SSEWriter } from "@/lib/server-sse";
import { logError } from "@/lib/errors";
import type { ApiError, PostmanAction, PostmanRequest } from "@/lib/types";

export const runtime = "nodejs";
const actions: PostmanAction[] = ["tick", "force", "forward", "reset"];
const failure: ApiError = { error: "邮差巡检暂时失败，请稍后重试", code: "POSTMAN_FAILED", retryable: true };

export async function POST(req: Request) {
  const input = await req.json().catch(() => ({})) as PostmanRequest | null;
  if (!input || typeof input !== "object" || Array.isArray(input) || (input.action !== undefined && !actions.includes(input.action)) || (input.days !== undefined && (typeof input.days !== "number" || !Number.isFinite(input.days)))) {
    return Response.json({ error: "邮差动作或天数无效", code: "INVALID_POSTMAN_REQUEST", retryable: false } satisfies ApiError, { status: 400 });
  }
  if (req.headers.get("Accept")?.includes("text/event-stream")) {
    const connection: { writer?: SSEWriter } = {};
    const response = sseResponse(req.signal, (writer) => {
      connection.writer = writer;
      return () => { delete connection.writer; };
    });
    // 无论连接是否已经取消都执行已接收的动作，断连只清理上面的推送引用。
    void runPostmanAction(input, (event, data) => connection.writer?.send(event, data)).catch((error) => {
      logError("postman.action", error);
      connection.writer?.send("error", { code: failure.code, message: failure.error, retryable: failure.retryable });
    }).finally(() => connection.writer?.close());
    return response;
  }
  try { return Response.json(await runPostmanAction(input)); }
  catch (error) { logError("postman.action", error); return Response.json(failure, { status: 500 }); }
}

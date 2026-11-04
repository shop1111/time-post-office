import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sseResponse } from "@/lib/server-sse";
import { registerInterviewCloser, tryStartInterview } from "@/lib/entry-work";
import { beginTurn, failTurn, renewTurn, ConversationError, type TurnRun } from "@/lib/xiaoju/session";
import { respond } from "@/lib/xiaoju/respond";

export const runtime = "nodejs";
const Input = z.object({ message: z.string().trim().max(4000).optional(), requestId: z.string().min(1).max(100).optional() }).strict();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const release = tryStartInterview(id);
  if (!release) return Response.json({ error: "小局正在回应，请稍等", code: "INTERVIEW_BUSY", retryable: true }, { status: 409 });
  let run: TurnRun;
  try {
    const input = Input.parse(await req.json());
    const message = input.message ?? "";
    run = await beginTurn(id, input.requestId ?? (message ? randomUUID() : "opening"), message);
  } catch (error) {
    release();
    const known = error instanceof ConversationError;
    return Response.json({
      error: known ? error.message : error instanceof z.ZodError || error instanceof SyntaxError ? "这句话没有发送成功，请检查内容" : "暂时无法开始对话，请重试",
      code: known ? error.code : "INTERVIEW_FAILED", retryable: !known || error.code === "INTERVIEW_BUSY",
    }, { status: known ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500 });
  }
  return sseResponse(req.signal, (writer) => {
    const unregister = registerInterviewCloser(id, writer.close);
    const lease = setInterval(() => { void renewTurn(run).catch(() => {}); }, 20_000);
    void (async () => {
      try {
        writer.send("meta", { requestId: run.turn.requestId, replay: run.replay });
        for await (const item of respond(run, () => writer.closed)) writer.send(item.event, item.data);
        if (!writer.closed) writer.send("done", { final: false, requestId: run.turn.requestId });
      } catch (error) {
        await failTurn(run).catch(() => {});
        writer.send("error", { code: error instanceof ConversationError ? error.code : "INTERVIEW_FAILED", message: error instanceof ConversationError ? error.message : "刚才没接上，你的话已经保存，可以重试", retryable: true });
      } finally { writer.close(); }
    })();
    return () => { clearInterval(lease); unregister(); release(); void failTurn(run).catch(() => {}); };
  });
}

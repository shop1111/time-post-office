import { db } from "@/lib/db";
import { chatStream, ChatStreamError, type ChatMessage } from "@/lib/ai/provider";
import { interviewSystem } from "@/lib/ai/prompts";
import { mockInterview } from "@/lib/ai/mock";
import { retrieve, formatMemories, fmtDate } from "@/lib/memory/retrieve";
import { DEFAULT_WEIGHTS } from "@/lib/memory/rank";
import { recognizeEntities } from "@/lib/memory/heuristics";
import { getProfile } from "@/lib/memory/profile";
import { now } from "@/lib/clock";
import { tryStartInterview } from "@/lib/entry-work";
import { sseResponse } from "@/lib/server-sse";
import { logError } from "@/lib/errors";
import type { ApiError, EntityType, ExecutionInfo, InterviewMetaEvent } from "@/lib/types";

export const runtime = "nodejs";
const MAX_ROUNDS = 3;
const fail = (status: number, code: string, error: string, retryable = false) => Response.json({ error, code, retryable } satisfies ApiError, { status });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const release = tryStartInterview(id);
  if (!release) return fail(409, "INTERVIEW_BUSY", "这一轮追问还在进行，请稍后再试", true);
  let streaming = false;
  try {
    const body = await req.json().catch(() => ({})) as { message?: unknown } | null;
    if (body?.message !== undefined && typeof body.message !== "string") return fail(400, "INVALID_MESSAGE", "message 必须是文字");
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    const entry = await db.entry.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    if (!entry) return fail(404, "ENTRY_NOT_FOUND", "找不到这条记录");
    const round = entry.messages.filter((m) => m.role === "assistant").length;
    if (entry.interviewDone || round >= MAX_ROUNDS) return fail(400, "INTERVIEW_LIMIT_REACHED", "追问已结束，请收进邮局");
    const response = sseResponse(req.signal, (writer) => {
      streaming = true;
      // 残缺回答和本轮输入都不入库，失败重试不会重复保存输入。
      void (async () => {
        try {
          const t = await now();
          const query = [entry.text, entry.transcript, entry.visionCaption, entry.place, message].filter(Boolean).join(" ");
          const known = await db.entity.findMany({ select: { name: true, type: true }, take: 200, orderBy: { createdAt: "desc" } });
          const entities = recognizeEntities(query, entry.place, known as Array<{ name: string; type: EntityType }>).map((e) => e.name);
          const weights = { ...DEFAULT_WEIGHTS };
          const related = query ? (await retrieve({ query, now: t, k: 3, excludeEntryId: id, entities, weights })).filter((r) => r.parts.sim > 0.12 || r.parts.entity > 0) : [];
          const profile = await getProfile();
          if (writer.closed) return;
          const history: ChatMessage[] = [
            { role: "system", content: interviewSystem({ type: entry.type, text: entry.text, caption: entry.visionCaption, place: entry.place, date: fmtDate(entry.occurredAt), related: formatMemories(related), profile: profile.summary, round, maxRounds: MAX_ROUNDS }) },
            ...entry.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          ];
          if (message) history.push({ role: "user", content: message });
          if (history.length === 1) history.push({ role: "user", content: "（用户刚寄出这条记录，请你开口）" });
          const lastUser = message || [...entry.messages].reverse().find((m) => m.role === "user")?.content;
          writer.send("meta", {
            round, maxRounds: MAX_ROUNDS, final: round >= MAX_ROUNDS - 1, weights,
            related: related.map((r) => ({ id: r.id, content: r.content, date: r.occurredAt.toISOString(), score: r.score, parts: r.parts, entryId: r.entryId })),
          } satisfies InterviewMetaEvent);
          let full = "";
          let execution: ExecutionInfo | undefined;
          for await (const delta of chatStream(history, {
            temperature: 0.85, maxTokens: 300, onExecution: (info) => { execution = info; },
            mock: () => mockInterview({ type: entry.type, text: entry.text, place: entry.place, round, maxRounds: MAX_ROUNDS, lastUser, related }),
          })) {
            if (writer.closed) return;
            full += delta;
            writer.send("delta", delta);
          }
          if (writer.closed) return;
          if (!full.trim() || !execution) throw new Error("Incomplete interview");
          await db.$transaction(async (tx) => {
            if (message) await tx.entryMessage.create({ data: { entryId: id, role: "user", content: message } });
            await tx.entryMessage.create({ data: { entryId: id, role: "assistant", content: full.trim() } });
          });
          writer.send("done", { final: round >= MAX_ROUNDS - 1, execution });
        } catch (error) {
          const interrupted = error instanceof ChatStreamError;
          writer.send("error", { code: interrupted ? error.code : "INTERVIEW_FAILED", message: interrupted ? "追问中断，请重试这一轮" : "追问暂时失败，请稍后重试", retryable: interrupted ? error.retryable : true });
          logError("interview", error);
        } finally { writer.close(); release(); }
      })();
    });
    return response;
  } catch (error) {
    logError("interview.prepare", error);
    return fail(500, "INTERVIEW_FAILED", "追问暂时失败，请稍后重试", true);
  } finally { if (!streaming) release(); }
}

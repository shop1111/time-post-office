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
import { loadCuratorContext, rememberSelf, renderCuratorContext } from "@/lib/curator/context";
import { EXTEND_MESSAGE, EXTENDED_MAX_ROUNDS, interviewState, MAX_ROUNDS, modelHistory, planTurn, turnReminder } from "@/lib/curator/planner";
import { classifyInput, clientKey, deflection, guardOutput, MAX_MESSAGE_CHARS, rateLimit } from "@/lib/curator/guard";
import { stripStageDirections } from "@/lib/curator/voice";
import type { ApiError, EntityType, ExecutionInfo, InterviewDoneEvent, InterviewMetaEvent } from "@/lib/types";

export const runtime = "nodejs";
const fail = (status: number, code: string, error: string, retryable = false) => Response.json({ error, code, retryable } satisfies ApiError, { status });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 限流：单个来源每分钟 6 次（可突发 8 次），全局每分钟 30 次
  if (!rateLimit(`interview:${clientKey(req)}`, 8, 6) || !rateLimit("interview:*", 40, 30)) return fail(429, "RATE_LIMITED", "说得有点快啦，歇一会儿再继续", true);
  const release = tryStartInterview(id);
  if (!release) return fail(409, "INTERVIEW_BUSY", "这一轮追问还在进行，请稍后再试", true);
  let streaming = false;
  try {
    const body = await req.json().catch(() => ({})) as { message?: unknown; extend?: unknown } | null;
    if (body?.message !== undefined && typeof body.message !== "string") return fail(400, "INVALID_MESSAGE", "message 必须是文字");
    const extendAsked = body?.extend === true;
    const message = typeof body?.message === "string" && body.message.trim() ? body.message.trim() : extendAsked ? EXTEND_MESSAGE : "";
    if (Array.from(message).length > MAX_MESSAGE_CHARS) return fail(400, "MESSAGE_TOO_LONG", `一次说得太多啦，分几次讲吧（最多 ${MAX_MESSAGE_CHARS} 字）`);
    const entry = await db.entry.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    if (!entry) return fail(404, "ENTRY_NOT_FOUND", "找不到这颗胶囊");
    const state = interviewState(entry.messages);
    const { round } = state;
    // 「再聊一会」只在小局收尾之后、还没聊满上限时有效
    const extend = extendAsked && state.closed && state.canExtend;
    if (entry.interviewDone || (state.closed && !extend)) return fail(400, "INTERVIEW_LIMIT_REACHED", "追问已结束，请收进邮局");
    const maxRounds = extend || state.prevActs.includes("close") ? EXTENDED_MAX_ROUNDS : MAX_ROUNDS;

    // 输入防线：注入 / 套设定 / 当通用模型用 / 危机 / 问身份 —— 不调用模型，小局直接回应
    const verdict = message ? classifyInput(message) : { kind: "ok" as const, hits: [] };

    const response = sseResponse(req.signal, (writer) => {
      streaming = true;
      // 残缺回答和本轮输入都不入库，失败重试不会重复保存输入。
      void (async () => {
        try {
          if (verdict.kind !== "ok") {
            const text = deflection(verdict.kind, message);
            writer.send("meta", { round, maxRounds, final: false, weights: DEFAULT_WEIGHTS, related: [] } satisfies InterviewMetaEvent);
            writer.send("delta", text);
            await db.$transaction(async (tx) => {
              await tx.entryMessage.create({ data: { entryId: id, role: "user", content: message } });
              await tx.entryMessage.create({ data: { entryId: id, role: "assistant", content: text, act: `deflect:${verdict.kind}` } });
            });
            console.warn(`[interview] guard ${verdict.kind} ${verdict.hits.join(",")}`);
            writer.send("done", { final: false, canExtend: false, execution: { mode: "mock", model: "guard", durationMs: 0, fallbackReason: `guard_${verdict.kind}` } } satisfies InterviewDoneEvent);
            return;
          }

          const t = await now();
          const query = [entry.text, entry.transcript, entry.visionCaption, entry.place, message].filter(Boolean).join(" ");
          const known = await db.entity.findMany({ select: { name: true, type: true }, take: 200, orderBy: { createdAt: "desc" } });
          const entities = recognizeEntities(query, entry.place, known as Array<{ name: string; type: EntityType }>).map((e) => e.name);
          const weights = { ...DEFAULT_WEIGHTS };
          const related = query ? (await retrieve({ query, now: t, k: 3, excludeEntryId: id, entities, weights })).filter((r) => r.parts.sim > 0.12 || r.parts.entity > 0) : [];
          const profile = await getProfile();
          const curator = await loadCuratorContext(t, { excludeEntryId: id });
          const lastUser = message || [...entry.messages].reverse().find((m) => m.role === "user")?.content;
          const plan = planTurn({ round, entryText: [entry.text, entry.transcript].filter(Boolean).join(" "), lastUser: message ? lastUser : undefined, prevActs: state.prevActs, stage: curator.relationship.stage, extend,
            prevReplies: modelHistory(entry.messages).filter((m) => m.role === "assistant").map((m) => m.content),
            prevUser: modelHistory(entry.messages).filter((m) => m.role === "user").map((m) => m.content) });
          if (writer.closed) return;
          const history: ChatMessage[] = [
            {
              role: "system",
              content: interviewSystem({
                type: entry.type, text: entry.text, caption: entry.visionCaption, place: entry.place, date: fmtDate(entry.occurredAt),
                related: formatMemories(related), profile: profile.summary, userName: profile.name,
                curator: renderCuratorContext(curator, profile.name, { closings: plan.act === "close" }), plan,
              }),
            },
            ...modelHistory(entry.messages).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          ];
          if (message) history.push({ role: "user", content: message });
          if (history.length === 1) history.push({ role: "user", content: "（用户刚放进这颗胶囊，请你开口）" });
          // 本轮提醒放在最后：压住历史里短回复的惯性
          history.push({ role: "system", content: turnReminder(plan) });
          writer.send("meta", {
            round, maxRounds, final: plan.final, weights,
            related: related.map((r) => ({ id: r.id, content: r.content, date: r.occurredAt.toISOString(), score: r.score, parts: r.parts, entryId: r.entryId })),
          } satisfies InterviewMetaEvent);
          let full = "";
          let execution: ExecutionInfo | undefined;
          for await (const delta of chatStream(history, {
            temperature: 0.9, maxTokens: 450, onExecution: (info) => { execution = info; },
            mock: () => mockInterview({ type: entry.type, text: entry.text, place: entry.place, lastUser, related, plan, world: curator.world, stage: curator.relationship.stage }),
          })) {
            if (writer.closed) return;
            full += delta;
            writer.send("delta", delta);
          }
          if (writer.closed) return;
          if (!full.trim() || !execution) throw new Error("Incomplete interview");
          // 输出防线：复述设定、输出代码、自报模型 → 整段换成小局的回应
          let act: string = plan.act;
          const out = guardOutput(full);
          if (out.kind !== "ok") {
            full = deflection(out.kind === "offtask" ? "offtask" : "probe", full);
            act = "deflect:output";
            writer.send("replace", full);
            console.warn(`[interview] output guard ${out.hits.join(",")}`);
          } else {
            // 去掉「（看着胶囊）」这类动作旁白
            const cleaned = stripStageDirections(full);
            if (cleaned !== full && cleaned.trim()) {
              full = cleaned;
              writer.send("replace", full);
            }
          }
          await db.$transaction(async (tx) => {
            if (message) await tx.entryMessage.create({ data: { entryId: id, role: "user", content: message } });
            await tx.entryMessage.create({ data: { entryId: id, role: "assistant", content: full.trim(), act } });
          });
          const final = act === "close";
          writer.send("done", { final, canExtend: final && round + 1 < EXTENDED_MAX_ROUNDS, execution } satisfies InterviewDoneEvent);
          // 小局回答了关于自己的问题，或顺口讲了邮局的事：记下来，下次别说岔了
          if (act === "answer" || act === "follow" || act === "close" || act === "reopen") void rememberSelf(full, "interview", id);
        } catch (error) {
          const interrupted = error instanceof ChatStreamError;
          writer.send("error", { code: interrupted ? error.code : "INTERVIEW_FAILED", message: interrupted ? "追问中断，请重试这一轮" : "追问暂时失败，请稍后重试", retryable: interrupted ? error.retryable : true });
          // 只记错误首行（不含用户内容），方便定位 Prisma 客户端过期、迁移未执行这类问题
          console.warn(`[interview] ${interrupted ? error.code : `failed: ${error instanceof Error ? error.message.split("\n").find((l) => l.trim())?.slice(0, 200) : "unknown"}`}`);
        } finally { writer.close(); release(); }
      })();
    });
    return response;
  } catch {
    return fail(500, "INTERVIEW_FAILED", "追问暂时失败，请稍后重试", true);
  } finally { if (!streaming) release(); }
}

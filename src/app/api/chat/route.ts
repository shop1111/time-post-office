import { db } from "@/lib/db";
import { chatStream, ChatStreamError, type ChatMessage as ModelMessage } from "@/lib/ai/provider";
import { chatSystem } from "@/lib/ai/prompts";
import { mockChat } from "@/lib/ai/mock";
import { retrieve, formatMemories } from "@/lib/memory/retrieve";
import { DEFAULT_WEIGHTS } from "@/lib/memory/rank";
import { recognizeEntities } from "@/lib/memory/heuristics";
import { getProfile } from "@/lib/memory/profile";
import { now } from "@/lib/clock";
import { sseResponse } from "@/lib/server-sse";
import { loadCuratorContext, rememberSelf, renderCuratorContext } from "@/lib/curator/context";
import { modelHistory, planChat, turnReminder } from "@/lib/curator/planner";
import { classifyInput, clientKey, deflection, guardOutput, MAX_MESSAGE_CHARS, rateLimit } from "@/lib/curator/guard";
import type { ApiError, ChatDoneEvent, EntityType, ExecutionInfo } from "@/lib/types";

export const runtime = "nodejs";
const fail = (status: number, code: string, error: string, retryable = false) => Response.json({ error, code, retryable } satisfies ApiError, { status });

/** 送进模型的最近几条聊天 */
const CONTEXT_MESSAGES = 20;
/** 页面上显示的历史条数 */
const HISTORY_LIMIT = 60;

/** 单机进程内只允许一轮在跑；globalThis 保证开发热更新也共用 */
const lock = globalThis as unknown as { freeChatBusy?: boolean };

export async function GET() {
  const rows = await db.chatMessage.findMany({ orderBy: { createdAt: "desc" }, take: HISTORY_LIMIT, select: { id: true, role: true, content: true, createdAt: true } });
  return Response.json({ messages: rows.reverse() });
}

/** 清空聊天记录（不影响胶囊和记忆） */
export async function DELETE() {
  if (lock.freeChatBusy) return fail(409, "CHAT_BUSY", "小局还在说话，等它说完再清空", true);
  await db.chatMessage.deleteMany({});
  return Response.json({ ok: true });
}

export async function POST(req: Request) {
  if (!rateLimit(`chat:${clientKey(req)}`, 8, 6) || !rateLimit("chat:*", 40, 30)) return fail(429, "RATE_LIMITED", "说得有点快啦，歇一会儿再继续", true);
  const body = await req.json().catch(() => null) as { message?: unknown } | null;
  if (typeof body?.message !== "string" || !body.message.trim()) return fail(400, "INVALID_MESSAGE", "说点什么吧");
  const message = body.message.trim();
  if (Array.from(message).length > MAX_MESSAGE_CHARS) return fail(400, "MESSAGE_TOO_LONG", `一次说得太多啦，分几次讲吧（最多 ${MAX_MESSAGE_CHARS} 字）`);
  if (lock.freeChatBusy) return fail(409, "CHAT_BUSY", "小局还在回上一句，稍等一下", true);
  lock.freeChatBusy = true;
  const release = () => { lock.freeChatBusy = false; };
  let streaming = false;
  try {
    const verdict = classifyInput(message);
    const recent = (await db.chatMessage.findMany({ orderBy: { createdAt: "desc" }, take: CONTEXT_MESSAGES })).reverse();

    const response = sseResponse(req.signal, (writer) => {
      streaming = true;
      // 和追问一样：没说完的回答和这一句输入都不入库，重试不会重复保存
      void (async () => {
        try {
          if (verdict.kind !== "ok") {
            const text = deflection(verdict.kind, message);
            writer.send("delta", text);
            await db.$transaction([
              db.chatMessage.create({ data: { role: "user", content: message } }),
              db.chatMessage.create({ data: { role: "assistant", content: text, act: `deflect:${verdict.kind}` } }),
            ]);
            console.warn(`[chat] guard ${verdict.kind} ${verdict.hits.join(",")}`);
            writer.send("done", { execution: { mode: "mock", model: "guard", durationMs: 0, fallbackReason: `guard_${verdict.kind}` } } satisfies ChatDoneEvent);
            return;
          }

          const t = await now();
          const known = await db.entity.findMany({ select: { name: true, type: true }, take: 200, orderBy: { createdAt: "desc" } });
          const entities = recognizeEntities(message, null, known as Array<{ name: string; type: EntityType }>).map((e) => e.name);
          const related = (await retrieve({ query: message, now: t, k: 3, entities, weights: { ...DEFAULT_WEIGHTS } })).filter((r) => r.parts.sim > 0.12 || r.parts.entity > 0);
          const profile = await getProfile();
          const curator = await loadCuratorContext(t);
          const history = modelHistory(recent);
          const plan = planChat({
            lastUser: message, prevActs: history.filter((m) => m.role === "assistant").map((m) => m.act ?? null), stage: curator.relationship.stage,
            prevReplies: history.filter((m) => m.role === "assistant" && !m.act?.startsWith("deflect")).map((m) => m.content),
            prevUser: history.filter((m) => m.role === "user").map((m) => m.content),
          });
          if (writer.closed) return;
          const messages: ModelMessage[] = [
            { role: "system", content: chatSystem({ related: formatMemories(related), profile: profile.summary, userName: profile.name, curator: renderCuratorContext(curator, profile.name), plan }) },
            // 模型要求 user 开头
            ...history.filter((m, i) => !(i === 0 && m.role === "assistant")).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
            { role: "user", content: message },
            // 本轮提醒放在最后：压住历史里一串短回复带来的惯性
            { role: "system", content: turnReminder(plan) },
          ];
          let full = "";
          let execution: ExecutionInfo | undefined;
          for await (const delta of chatStream(messages, {
            temperature: 0.9, maxTokens: 400, onExecution: (info) => { execution = info; },
            mock: () => mockChat({ lastUser: message, act: plan.act, related, world: curator.world }),
          })) {
            if (writer.closed) return;
            full += delta;
            writer.send("delta", delta);
          }
          if (writer.closed) return;
          if (!full.trim() || !execution) throw new Error("Incomplete chat");
          let act: string = plan.act;
          const out = guardOutput(full);
          if (out.kind !== "ok") {
            full = deflection(out.kind === "offtask" ? "offtask" : "probe", full);
            act = "deflect:output";
            writer.send("replace", full);
            console.warn(`[chat] output guard ${out.hits.join(",")}`);
          }
          await db.$transaction([
            db.chatMessage.create({ data: { role: "user", content: message } }),
            db.chatMessage.create({ data: { role: "assistant", content: full.trim(), act } }),
          ]);
          writer.send("done", { execution } satisfies ChatDoneEvent);
          if (!act.startsWith("deflect")) void rememberSelf(full, "chat");
        } catch (error) {
          const interrupted = error instanceof ChatStreamError;
          writer.send("error", { code: interrupted ? error.code : "CHAT_FAILED", message: interrupted ? "小局的话说到一半断了，再发一次吧" : "小局暂时没回上话，稍后再试", retryable: interrupted ? error.retryable : true });
          console.warn(`[chat] ${interrupted ? error.code : `failed: ${error instanceof Error ? error.message.split("\n").find((l) => l.trim())?.slice(0, 200) : "unknown"}`}`);
        } finally { writer.close(); release(); }
      })();
    });
    return response;
  } catch {
    return fail(500, "CHAT_FAILED", "小局暂时没回上话，稍后再试", true);
  } finally { if (!streaming) release(); }
}

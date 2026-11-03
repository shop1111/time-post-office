import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { chat, isMock } from "@/lib/ai/provider";
import { chatJson } from "@/lib/ai/json";
import { letterMessages, rewriteMessages, selfCheckMessages } from "@/lib/ai/prompts";
import { mockLetter } from "@/lib/ai/mock";
import { retrieve, formatMemories, fmtDate, type RetrievedMemory } from "@/lib/memory/retrieve";
import { NOSTALGIA_WEIGHTS } from "@/lib/memory/rank";
import { getProfile, styleText } from "@/lib/memory/profile";
import type { ExecutionInfo, PostmanStage, PostmanStageInfo } from "@/lib/types";
import type { LetterCandidate } from "./triggers";

export class AlreadySentError extends Error {
  constructor(public readonly letterId: string) { super("Trigger already has a letter"); this.name = "AlreadySentError"; }
}
const LetterSchema = z.object({ subject: z.string().min(1).max(40), body: z.string().min(40).max(1500), cited: z.array(z.string()).default([]) });

/** 同阶段可能有查询/补向量或核查/改写两次调用，汇总实际执行，不伪装单次调用。 */
function summarize(infos: ExecutionInfo[]): ExecutionInfo | undefined {
  if (!infos.length) return undefined;
  const fallback = infos.find((info) => info.mode === "fallback");
  const model = [...new Set(infos.flatMap((info) => info.model ? [info.model] : []))].join(", ");
  return {
    mode: fallback ? "fallback" : infos.some((info) => info.mode === "remote") ? "remote" : "mock",
    ...(model ? { model } : {}), durationMs: infos.reduce((sum, info) => sum + info.durationMs, 0),
    ...(fallback?.fallbackReason ? { fallbackReason: fallback.fallbackReason } : infos.every((info) => info.mode === "mock") && infos[0].fallbackReason ? { fallbackReason: infos[0].fallbackReason } : {}),
  };
}

export async function writeLetter(c: LetterCandidate, now: Date, onStage?: (stage: PostmanStageInfo) => void) {
  async function stage<T>(name: PostmanStage, work: (capture: (info: ExecutionInfo) => void) => Promise<T>, skip = false): Promise<T> {
    const started = Date.now();
    const infos: ExecutionInfo[] = [];
    if (!skip) onStage?.({ name, status: "started" });
    try {
      const value = await work((info) => infos.push(info));
      const execution = summarize(infos);
      // completed 是执行完成，不代表 M3 的事实核查 verdict；核查降级不能标成完成。
      const status = skip ? "skipped" : name === "check" && execution?.mode !== "remote" ? "failed" : "completed";
      onStage?.({ name, status, durationMs: Date.now() - started, ...(execution ? { execution } : {}) });
      return value;
    } catch (error) {
      const execution = summarize(infos);
      onStage?.({ name, status: error instanceof AlreadySentError ? "skipped" : "failed", durationMs: Date.now() - started, ...(execution ? { execution } : {}) });
      throw error;
    }
  }

  const { mems, memText, profile, style, desc } = await stage("retrieve", async (onExecution) => {
    const profile = await getProfile();
    const { style, desc } = await styleText();
    // 本批保留旧的时间边界；M3 统一处理画像、锚点和检索的落款日限制。
    const anchors = (await db.memory.findMany({ where: { id: { in: c.anchorMemoryIds } }, include: { entities: { include: { entity: true } } } })).sort((a, b) => c.anchorMemoryIds.indexOf(a.id) - c.anchorMemoryIds.indexOf(b.id));
    const extra = await retrieve({ query: c.query || c.reason, now, k: 5, entities: c.entities, weights: NOSTALGIA_WEIGHTS,
      before: c.sender === "past_self" ? new Date(c.writtenAt.getTime() + 86_400_000) : undefined, onExecution });
    const anchorMems: RetrievedMemory[] = anchors.map((a) => ({ id: a.id, kind: a.kind, content: a.content, importance: a.importance, occurredAt: a.occurredAt, entryId: a.entryId,
      entities: a.entities.map((e) => e.entity.name), score: 99, parts: { sim: 1, recency: 0, importance: a.importance / 10, entity: 1 } }));
    const mems = [...anchorMems, ...extra.filter((e) => !c.anchorMemoryIds.includes(e.id))].slice(0, 7);
    return { mems, memText: formatMemories(mems), profile, style, desc };
  });

  const draft = await stage("generate", async (onExecution) => {
    if (process.env.NODE_ENV !== "production" && process.env.POSTMAN_DEBUG_FAIL === c.type) {
      const error = new Error(`Intentional postman generate failure (${c.type})`);
      error.name = "PostmanDebugFailure";
      throw error;
    }
    return chatJson(LetterSchema, letterMessages({ sender: c.sender, reason: c.reason, today: fmtDate(now), writtenAt: fmtDate(c.writtenAt), memories: memText, style: desc, profile: profile.summary, name: profile.name }), {
      temperature: 0.85, maxTokens: 1400, onExecution,
      mock: () => mockLetter({ sender: c.sender, reason: c.reason, memories: mems, style, name: profile.name, writtenAt: c.writtenAt, today: now }),
    });
  });

  const skipCheck = isMock();
  const { body, cited, checked } = await stage("check", async (onExecution) => {
    const validIds = new Set(mems.map((m) => m.id));
    let cited = draft.cited.filter((id) => validIds.has(id));
    if (!cited.length) cited = c.anchorMemoryIds.filter((id) => validIds.has(id));
    let body = draft.body;
    let checked = "引用校验通过";
    if (!skipCheck) {
      const infos: ExecutionInfo[] = [];
      const capture = (info: ExecutionInfo) => { infos.push(info); onExecution(info); };
      const check = await chatJson(z.object({ ok: z.boolean(), issues: z.array(z.string()).default([]) }), selfCheckMessages(body, memText), {
        mock: () => ({ ok: true, issues: [] }), temperature: 0, onExecution: capture,
      });
      if (!check.ok && check.issues.length) {
        body = await chat(rewriteMessages(body, check.issues, memText), { temperature: 0.5, maxTokens: 1400, mock: () => body, onExecution: capture });
        checked = `已修正 ${check.issues.length} 处无依据表述`;
      } else checked = "事实核查通过";
      if (infos.some((info) => info.mode !== "remote")) checked = "事实核查未完成";
    }
    return { body, cited, checked };
  }, skipCheck);

  return stage("deliver", async () => {
    try {
      return await db.letter.create({ data: {
        sender: c.sender, subject: draft.subject, body: body.trim(), triggerType: c.type, triggerKey: c.key,
        reason: `${c.reason}。（${checked}）`, citedMemoryIds: JSON.stringify(cited), writtenAt: c.writtenAt, scheduledAt: now, deliveredAt: now,
      } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await db.letter.findUnique({ where: { triggerKey: c.key }, select: { id: true } });
        if (existing) throw new AlreadySentError(existing.id);
      }
      throw error;
    }
  });
}

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { isMock } from "@/lib/ai/provider";
import { chatJson } from "@/lib/ai/json";
import { letterMessages } from "@/lib/ai/prompts";
import { mockLetter } from "@/lib/ai/mock";
import { retrieve, formatMemories, fmtDate, type RetrievedMemory } from "@/lib/memory/retrieve";
import { NOSTALGIA_WEIGHTS } from "@/lib/memory/rank";
import { getProfile, styleText } from "@/lib/memory/profile";
import type { ExecutionInfo, PostmanStage, PostmanStageInfo } from "@/lib/types";
import type { LetterCandidate } from "./triggers";
import { checkLetter } from "./check";
import { historicalStyle, writtenDayEnd } from "./history";
import { verifiedSnapshots } from "@/lib/letters/snapshot";

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
  async function stage<T>(name: PostmanStage, work: (capture: (info: ExecutionInfo) => void) => Promise<T>, skip = false, failed?: (value: T) => boolean): Promise<T> {
    const started = Date.now();
    const infos: ExecutionInfo[] = [];
    if (!skip) onStage?.({ name, status: "started" });
    try {
      const value = await work((info) => infos.push(info));
      const execution = summarize(infos);
      // completed 是执行完成，不代表 M3 的事实核查 verdict；核查降级不能标成完成。
      const status = skip ? "skipped" : failed?.(value) ? "failed" : "completed";
      onStage?.({ name, status, durationMs: Date.now() - started, ...(execution ? { execution } : {}) });
      return value;
    } catch (error) {
      const execution = summarize(infos);
      onStage?.({ name, status: error instanceof AlreadySentError ? "skipped" : "failed", durationMs: Date.now() - started, ...(execution ? { execution } : {}) });
      throw error;
    }
  }

  const { mems, memText, profile, style, desc, writingReason } = await stage("retrieve", async (onExecution) => {
    const before = c.sender === "past_self" ? writtenDayEnd(c.writtenAt) : undefined;
    const profile = before ? { name: "你", summary: "" } : await getProfile();
    const { style, desc } = before ? await historicalStyle(before) : await styleText();
    const anchors = (await db.memory.findMany({ where: { id: { in: c.anchorMemoryIds }, ...(before ? {
      occurredAt: { lt: before }, OR: [{ entryId: null }, { entry: { occurredAt: { lt: before } } }],
    } : {}) }, include: { entities: { include: { entity: true } } } })).sort((a, b) => c.anchorMemoryIds.indexOf(a.id) - c.anchorMemoryIds.indexOf(b.id));
    // 候选reason/query/entities也可能混入后来的信息，过去的你仅从合格锚点重建检索输入。
    const query = before ? anchors.map((m) => m.content).join(" ") || "过去记录下的生活" : c.query || c.reason;
    const entities = before ? [...new Set(anchors.flatMap((m) => m.entities.filter((e) => m.content.includes(e.entity.name)).map((e) => e.entity.name)))] : c.entities;
    const writingReason = before ? c.type === "open_loop" ? "把当时的计划写给未来，问问后来怎么样了；那个日子应该已经到了" : "把落款这一天已经知道的生活，写给未来的自己" : c.reason;
    const extra = await retrieve({ query, now: before ? c.writtenAt : now, k: 5, entities, weights: NOSTALGIA_WEIGHTS, before, onExecution });
    const anchorMems: RetrievedMemory[] = anchors.map((a) => ({ id: a.id, kind: a.kind, content: a.content, importance: a.importance, occurredAt: a.occurredAt, entryId: a.entryId,
      entities: a.entities.map((e) => e.entity.name), score: 99, parts: { sim: 1, recency: 0, importance: a.importance / 10, entity: 1 } }));
    const mems = [...anchorMems, ...extra.filter((e) => !c.anchorMemoryIds.includes(e.id))].slice(0, 7);
    if (before) profile.summary = mems.map((memory) => memory.content).join("；");
    return { mems, memText: formatMemories(mems), profile, style, desc, writingReason };
  });

  const draft = await stage("generate", async (onExecution) => {
    if (process.env.NODE_ENV !== "production" && process.env.POSTMAN_DEBUG_FAIL === c.type) {
      const error = new Error(`Intentional postman generate failure (${c.type})`);
      error.name = "PostmanDebugFailure";
      throw error;
    }
    return chatJson(LetterSchema, letterMessages({ sender: c.sender, reason: writingReason, today: fmtDate(now), writtenAt: fmtDate(c.writtenAt), memories: memText, style: desc, profile: profile.summary, name: profile.name }), {
      temperature: 0.85, maxTokens: 1400, onExecution,
      mock: () => mockLetter({ sender: c.sender, reason: writingReason, memories: mems, style, name: profile.name, writtenAt: c.writtenAt, today: now }),
    });
  });

  const validIds = new Set(mems.map((m) => m.id));
  let cited = [...new Set(draft.cited.filter((id) => validIds.has(id)))];
  if (!cited.length) cited = c.anchorMemoryIds.filter((id) => validIds.has(id));
  const checked = await stage("check", (onExecution) => checkLetter(draft.body, memText, { onExecution }), isMock(),
    (result) => result.checkStatus === "unchecked" || result.checkStatus === "failed");

  return stage("deliver", async () => {
    try {
      return await db.$transaction(async (tx) => {
        const { snapshots, changed } = await verifiedSnapshots(tx, cited, mems);
        return tx.letter.create({ data: {
          sender: c.sender, subject: draft.subject, body: checked.body.trim(), triggerType: c.type, triggerKey: c.key,
          reason: c.reason, checkStatus: changed ? "unchecked" : checked.checkStatus,
          checkNote: changed ? "引用记忆在写信期间发生变化，相关引用已移除，请谨慎阅读" : checked.checkNote,
          citedMemoryIds: JSON.stringify(snapshots.map((snapshot) => snapshot.memoryId)), citedSnapshot: JSON.stringify(snapshots),
          writtenAt: c.writtenAt, scheduledAt: now, deliveredAt: now,
        } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await db.letter.findUnique({ where: { triggerKey: c.key }, select: { id: true } });
        if (existing) throw new AlreadySentError(existing.id);
      }
      throw error;
    }
  });
}

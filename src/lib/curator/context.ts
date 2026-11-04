/**
 * 小局的上下文：世界状态 + 关系状态 + 自我记忆 + 最近说过的话。
 * 追问和来信共用，保证小局在两个地方是同一个「人」。
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { CAPSULE_WHERE } from "@/lib/capsules";
import { chatJson } from "@/lib/ai/json";
import { isMock } from "@/lib/ai/provider";
import { fmtDate } from "@/lib/memory/retrieve";
import { selfNoteMessages } from "@/lib/ai/prompts";
import { renderWorld, worldState, type WorldState } from "./world";
import { computeRelationship, renderRelationship, type Relationship } from "./relationship";
import { openingLine, similarity } from "./voice";

/** 小局的信（含旧数据里的邮差来信） */
export const CURATOR_SENDERS = ["curator", "postman", "past_self", "future_self"];
const MAX_NOTES = 200;

export interface CuratorContext {
  world: WorldState;
  relationship: Relationship;
  selfNotes: string[];
  recentLetters: Array<{ subject: string; opening: string; at: Date; type: string }>;
  recentClosings: string[];
}

/**
 * 读不到关系、自我记忆时（比如数据库还没 db:push、Prisma 客户端没重新生成）不让对话失败：
 * 退回只有世界状态、关系为「初识」的最小上下文。
 */
export async function loadCuratorContext(now: Date, opts: { excludeEntryId?: string } = {}): Promise<CuratorContext> {
  try {
    return await loadFull(now, opts);
  } catch (e) {
    console.warn("[curator] 上下文读取失败，降级为最小上下文：", e instanceof Error ? e.message.split("\n")[0] : e);
    return {
      world: worldState(now),
      relationship: computeRelationship({ firstAt: null, lastAt: null, capsules: 0, lettersToCurator: 0, lettersFromCurator: 0, topPeople: [] }, now),
      selfNotes: [], recentLetters: [], recentClosings: [],
    };
  }
}

async function loadFull(now: Date, opts: { excludeEntryId?: string }): Promise<CuratorContext> {
  const [firstEntry, lastEntry, capsules, toCurator, lastToCurator, fromCurator, recent, notes, closings, people] = await Promise.all([
    db.entry.findFirst({ where: CAPSULE_WHERE, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    db.entry.findFirst({ where: { ...CAPSULE_WHERE, ...(opts.excludeEntryId ? { NOT: { id: opts.excludeEntryId } } : {}) }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.entry.count({ where: CAPSULE_WHERE }),
    db.letter.count({ where: { sender: "user", correspondent: { kind: "curator" } } }),
    db.letter.findFirst({ where: { sender: "user" }, orderBy: { writtenAt: "desc" }, select: { writtenAt: true } }),
    db.letter.count({ where: { sender: { in: CURATOR_SENDERS }, deliveredAt: { not: null } } }),
    db.letter.findMany({ where: { sender: { in: CURATOR_SENDERS }, deliveredAt: { not: null } }, orderBy: { deliveredAt: "desc" }, take: 3, select: { subject: true, body: true, deliveredAt: true, triggerType: true } }),
    db.curatorNote.findMany({ orderBy: { createdAt: "desc" }, take: 12, select: { content: true } }),
    db.entryMessage.findMany({
      where: { role: "assistant", act: "close", ...(opts.excludeEntryId ? { NOT: { entryId: opts.excludeEntryId } } : {}) },
      orderBy: { createdAt: "desc" }, take: 3, select: { content: true },
    }),
    db.entity.findMany({ where: { type: "person" }, include: { _count: { select: { memories: { where: { memory: ACTIVE_MEMORY } } } } } }),
  ]);
  const times = [firstEntry?.createdAt].filter(Boolean) as Date[];
  const lastTimes = [lastEntry?.createdAt, lastToCurator?.writtenAt].filter(Boolean) as Date[];
  const relationship = computeRelationship(
    {
      firstAt: times.length ? new Date(Math.min(...times.map((t) => t.getTime()))) : null,
      lastAt: lastTimes.length ? new Date(Math.max(...lastTimes.map((t) => t.getTime()))) : null,
      capsules,
      lettersToCurator: toCurator,
      lettersFromCurator: fromCurator,
      topPeople: people.filter((p) => p._count.memories >= 2).sort((a, b) => b._count.memories - a._count.memories).map((p) => p.name),
    },
    now,
  );
  return {
    world: worldState(now),
    relationship,
    selfNotes: notes.map((n) => n.content).reverse(),
    recentLetters: recent.map((l) => ({ subject: l.subject, opening: openingLine(l.body), at: l.deliveredAt!, type: l.triggerType })),
    recentClosings: closings.map((c) => c.content.slice(0, 40)),
  };
}

/** 组装成提示词段落 */
export function renderCuratorContext(c: CuratorContext, userName: string, opts: { letters?: boolean; closings?: boolean } = {}): string {
  const parts = [`【此刻】\n${renderWorld(c.world)}`, `【你们的关系】\n${renderRelationship(c.relationship, userName)}`];
  if (c.selfNotes.length) parts.push(`【你以前说过的、关于你自己和邮局的事】（保持一致，不要说出和这些矛盾的话）\n${c.selfNotes.map((n) => `- ${n}`).join("\n")}`);
  if (opts.letters && c.recentLetters.length) {
    parts.push(`【你最近写给TA的信】（别重复这些开头和说法；TA没回也别追着问）\n${c.recentLetters.map((l) => `- ${fmtDate(l.at)}《${l.subject}》开头：${l.opening}`).join("\n")}`);
  }
  if (opts.closings && c.recentClosings.length) parts.push(`【你最近几次道别时说的话】（这次换个说法）\n${c.recentClosings.map((l) => `- ${l}`).join("\n")}`);
  return parts.join("\n\n");
}

// ———————————————————— 自我记忆 ————————————————————

const NotesSchema = z.object({ notes: z.array(z.string().min(2).max(60)).max(5).default([]) });

/**
 * 从小局说的话里抽出「关于它自己和邮局」的新细节存下来。
 * 只在真实模型下运行（Mock 的世界细节来自确定性的世界状态，本身就一致）；失败不影响主流程。
 */
export async function rememberSelf(text: string, source: "letter" | "interview" | "chat", sourceId?: string): Promise<string[]> {
  if (isMock() || text.length < 8) return [];
  try {
    const existing = (await db.curatorNote.findMany({ orderBy: { createdAt: "desc" }, take: MAX_NOTES, select: { content: true } })).map((n) => n.content);
    const { notes } = await chatJson(NotesSchema, selfNoteMessages(text, existing.slice(0, 30)), { temperature: 0, maxTokens: 400, mock: () => ({ notes: [] }) });
    const fresh = notes.map((n) => n.trim()).filter((n) => n && !existing.some((e) => similarity(e, n) > 0.55));
    if (fresh.length) await db.curatorNote.createMany({ data: fresh.map((content) => ({ content, source, sourceId })) });
    const total = await db.curatorNote.count();
    if (total > MAX_NOTES) {
      const old = await db.curatorNote.findMany({ orderBy: { createdAt: "asc" }, take: total - MAX_NOTES, select: { id: true } });
      await db.curatorNote.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    }
    return fresh;
  } catch (e) {
    console.warn("[curator] 自我记忆抽取失败", e instanceof Error ? e.message : e);
    return [];
  }
}

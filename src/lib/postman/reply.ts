/**
 * 代笔回信：你寄给虚拟收件人（某个人 / 平行时空的自己 / 小局）的信，在几小时到一天后由 agent 代笔回信。
 * 某个人：检索 → 推理「他会知道什么」→ 只用他知道的事写信 → 越界核查
 * 平行时空的自己：只能看到分岔点之前的记忆
 */
import { z } from "zod";
import type { Correspondent, Letter } from "@prisma/client";
import { db } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { chat, isMock } from "@/lib/ai/provider";
import { chatJson } from "@/lib/ai/json";
import { knowledgeGateMessages, letterMessages, parallelSelfMessages, personaReplyMessages, rewriteMessages, selfCheckMessages } from "@/lib/ai/prompts";
import { mockCuratorLetter, mockParallelReply, mockPersonaReply } from "@/lib/ai/mock";
import { retrieve, formatMemories, fmtDate, type RetrievedMemory } from "@/lib/memory/retrieve";
import { NOSTALGIA_WEIGHTS } from "@/lib/memory/rank";
import { getProfile, styleText } from "@/lib/memory/profile";
import { instantReplies } from "@/lib/correspondents";
import { LETTER_ENTRY_TYPE } from "@/lib/capsules";
import type { LetterKnowledge, KnowledgeVerdict } from "@/lib/types";

const HOUR = 3_600_000;
export const REPLY_MIN_HOURS = 2;
export const REPLY_MAX_HOURS = 24;

/** 回信延迟：随机 2~24 小时；演示开关打开时立即送达 */
export function pickReplyDelay(rand: () => number = Math.random, instant = false): number {
  if (instant) return 0;
  return Math.round((REPLY_MIN_HOURS + rand() * (REPLY_MAX_HOURS - REPLY_MIN_HOURS)) * HOUR);
}

export async function replyDueAt(now: Date) {
  return new Date(now.getTime() + pickReplyDelay(Math.random, await instantReplies()));
}

export interface GateCandidate {
  id: string;
  kind: string;
  content: string;
  entities: string[];
}

/** 规则版知识边界（Mock 兜底）：他在场的经历、或你在信里告诉过他的事，才算他知道 */
export function gateByRules(name: string, cands: GateCandidate[], thread: string): { known: Array<{ id: string; why: string }>; unknown: Array<{ id: string; why: string }> } {
  const known: Array<{ id: string; why: string }> = [];
  const unknown: Array<{ id: string; why: string }> = [];
  const plain = thread.replace(/[\s，。！？、,.!?「」“”]/g, "");
  for (const c of cands) {
    if (c.entities.includes(name) && ["event", "person", "fact"].includes(c.kind)) {
      known.push({ id: c.id, why: c.kind === "event" ? `${name}也在场` : `这是你们之间的事` });
    } else if (toldInThread(c.content, plain)) {
      known.push({ id: c.id, why: `你在信里告诉过${name}` });
    } else {
      unknown.push({ id: c.id, why: c.entities.includes(name) ? `提到了${name}，但TA不一定在场` : `${name}没有参与，也没听你说过` });
    }
  }
  return { known, unknown };
}

/** 记忆里有足够多的连续 4 字片段出现在信里，才当作信里讲过；只撞上一个词（如「项目上线」）不算，拿不准就算不知道 */
function toldInThread(content: string, plainThread: string) {
  const c = content.replace(/[\s，。！？、,.!?「」“”]/g, "");
  const grams = new Set<string>();
  for (let i = 0; i + 4 <= c.length; i++) grams.add(c.slice(i, i + 4));
  if (!grams.size) return false;
  let hits = 0;
  for (const g of grams) if (plainThread.includes(g)) hits++;
  return hits >= 3 || hits / grams.size >= 0.4;
}

/** 平行时空：检索条件只看分岔点之前 */
export function parallelQuery(c: { moment: string; momentAt: Date | null }, letter: string) {
  if (!c.momentAt) throw new Error("平行时空的收件人缺少分岔点");
  return { query: `${c.moment} ${letter}`.slice(0, 400), before: c.momentAt };
}

type Thread = Array<Pick<Letter, "sender" | "subject" | "body" | "writtenAt">>;

function formatThread(thread: Thread, name: string, userName: string) {
  return thread
    .map((l) => `[${fmtDate(l.writtenAt)}] ${l.sender === "user" ? `${userName} → ${name}` : `${name} → ${userName}`}《${l.subject}》：${l.body.slice(0, 400)}`)
    .join("\n");
}

const ReplySchema = z.object({
  subject: z.string().min(1).max(40),
  body: z.string().min(40).max(1500),
  cited: z.array(z.string()).default([]),
});
const GateSchema = z.object({
  known: z.array(z.object({ id: z.string(), why: z.string().default("") })).default([]),
  unknown: z.array(z.object({ id: z.string(), why: z.string().default("") })).default([]),
});

/** 投递所有到期的代笔回信；失败的留到下次检查再试 */
export async function processDueReplies(now: Date): Promise<string[]> {
  const due = await db.letter.findMany({
    where: { sender: "user", replyDueAt: { lte: now }, replyLetterId: null },
    include: { correspondent: true },
    orderBy: { replyDueAt: "asc" },
    take: 5,
  });
  const out: string[] = [];
  for (const l of due) {
    if (!l.correspondent) continue;
    // 先占位，避免两次检查同时代笔
    const claim = await db.letter.updateMany({ where: { id: l.id, replyLetterId: null }, data: { replyLetterId: `pending:${now.getTime()}` } });
    if (!claim.count) continue;
    try {
      const reply = await writeReply(l, l.correspondent, now);
      await db.letter.update({ where: { id: l.id }, data: { replyLetterId: reply.id } });
      out.push(reply.id);
    } catch (e) {
      console.error("[reply] 代笔失败，下次再试", e);
      await db.letter.update({ where: { id: l.id }, data: { replyLetterId: null } });
    }
  }
  return out;
}

export async function writeReply(out: Letter, to: Correspondent, now: Date) {
  const profile = await getProfile();
  const thread = await db.letter.findMany({
    where: { correspondentId: to.id, id: { not: out.id }, writtenAt: { lte: out.writtenAt }, OR: [{ sender: "user" }, { deliveredAt: { not: null } }] },
    orderBy: { writtenAt: "asc" },
    select: { sender: true, subject: true, body: true, writtenAt: true },
  });
  const threadText = formatThread(thread, to.name, profile.name);
  const letterText = `《${out.subject}》\n${out.body}`;

  let draft: z.infer<typeof ReplySchema>;
  let factText: string;
  let knowledge: LetterKnowledge;
  let checkNote = "";
  let sender: "persona" | "curator" = "persona";
  let validIds: Set<string>;

  if (to.kind === "person") {
    const pool = await personaCandidates(to, out);
    const candidates = formatMemories(pool);
    const ctx = {
      name: to.name, relation: to.relation, moment: to.moment, momentAt: to.momentAt ? fmtDate(to.momentAt) : "某一天",
      voice: to.voice, userName: profile.name, today: fmtDate(now), thread: `${threadText}\n[${fmtDate(out.writtenAt)}] ${profile.name} → ${to.name}：${letterText}`, candidates,
    };
    const gate = pool.length
      ? await chatJson(GateSchema, knowledgeGateMessages(ctx), { temperature: 0, maxTokens: 900, mock: () => gateByRules(to.name, pool, ctx.thread) })
      : { known: [], unknown: [] };
    const byId = new Map(pool.map((m) => [m.id, m]));
    const knownIds = new Set(gate.known.map((k) => k.id).filter((id) => byId.has(id)));
    const verdict = (id: string, why: string): KnowledgeVerdict => ({ id, content: byId.get(id)!.content, why });
    knowledge = {
      known: gate.known.filter((k) => knownIds.has(k.id)).map((k) => verdict(k.id, k.why)),
      // 模型漏判的候选一律当作「不知道」
      unknown: pool.filter((m) => !knownIds.has(m.id)).map((m) => verdict(m.id, gate.unknown.find((u) => u.id === m.id)?.why ?? "判断为TA不知道")),
    };
    const known = pool.filter((m) => knownIds.has(m.id));
    validIds = knownIds;
    factText = `${formatMemories(known)}\n往来信件：\n${ctx.thread}`;
    draft = await chatJson(ReplySchema, personaReplyMessages({ ...ctx, thread: threadText, known: known.length ? formatMemories(known) : "", letter: letterText }), {
      temperature: 0.85,
      maxTokens: 1400,
      mock: () => mockPersonaReply({ name: to.name, userName: profile.name, moment: to.moment, momentAt: to.momentAt, letter: out.body, known, isFirst: !thread.some((t) => t.sender !== "user") }),
    });
    checkNote = "收信人在信里亲口说过的事也算有依据。";
  } else if (to.kind === "parallel_self") {
    const { query, before } = parallelQuery(to, out.body);
    const { style, desc } = await styleText();
    const mems = await retrieve({ query, now, k: 6, weights: NOSTALGIA_WEIGHTS, before, touch: false });
    validIds = new Set(mems.map((m) => m.id));
    knowledge = { known: mems.map((m) => ({ id: m.id, content: m.content, why: "发生在分岔点之前" })), unknown: [], before: before.toISOString() };
    factText = formatMemories(mems);
    draft = await chatJson(
      ReplySchema,
      parallelSelfMessages({ userName: profile.name, divergenceAt: fmtDate(before), divergence: to.moment, today: fmtDate(now), memories: factText, style: desc, thread: threadText, letter: letterText }),
      { temperature: 0.9, maxTokens: 1400, mock: () => mockParallelReply({ userName: profile.name, divergence: to.moment, divergenceAt: before, letter: out.body, memories: mems, style }) },
    );
    checkNote = `只核查 ${fmtDate(before)} 之前的真实事实；平行时空里分岔之后的另一种人生是想象，不算无依据，但如果冒用了分岔点之后的真实经历要指出。`;
  } else {
    // 小局：可以看到你放进来的所有胶囊
    sender = "curator";
    const { style } = await styleText();
    const mems = await retrieve({ query: out.body, now, k: 5 });
    validIds = new Set(mems.map((m) => m.id));
    knowledge = { known: [], unknown: [] };
    factText = formatMemories(mems);
    draft = await chatJson(
      ReplySchema,
      letterMessages({ reason: `你在${fmtDate(out.writtenAt)}给小局写了一封信`, today: fmtDate(now), memories: factText, profile: profile.summary, name: profile.name, userLetter: letterText }),
      { temperature: 0.85, maxTokens: 1400, mock: () => mockCuratorLetter({ type: "reply", reason: "", memories: mems, style, name: profile.name, today: now, userLetter: out.body }) },
    );
  }

  const { body, checkStatus, checked } = await factCheck(draft.body, factText, checkNote);
  const cited = draft.cited.filter((id) => validIds.has(id));
  const who = to.kind === "parallel_self" ? "平行时空里的你" : to.name;
  const reason =
    sender === "curator"
      ? `这是小局给你${fmtDate(out.writtenAt)}那封信《${out.subject}》的回信。（${checked}）`
      : `你在${fmtDate(out.writtenAt)}给${who}寄了一封信《${out.subject}》。这封回信由 agent 以${who}的身份代笔，${to.kind === "person" ? `只用了${to.name}会知道的事` : `只用了 ${fmtDate(to.momentAt!)} 分岔之前的真实回忆`}。（${checked}）`;

  return db.letter.create({
    data: {
      sender,
      correspondentId: to.id,
      inReplyToId: out.id,
      subject: draft.subject,
      body: body.trim(),
      triggerType: "reply",
      reason,
      checkStatus,
      checkNote: checked,
      citedMemoryIds: JSON.stringify(cited),
      knowledge: JSON.stringify(knowledge),
      writtenAt: now,
      scheduledAt: now,
      deliveredAt: now,
    },
  });
}

/** 某个人的候选记忆：与这封信、那个瞬间相关的检索结果 + 提到他的记忆 */
async function personaCandidates(to: Correspondent, out: Letter): Promise<RetrievedMemory[]> {
  const found = await retrieve({ query: `${to.moment} ${out.body}`.slice(0, 400), now: out.writtenAt, k: 12, entities: [to.name], touch: false });
  const mentioned = await db.memory.findMany({
    where: { ...ACTIVE_MEMORY, entities: { some: { entity: { name: to.name } } } },
    include: { entities: { include: { entity: true } } },
    orderBy: { importance: "desc" },
    take: 8,
  });
  const ids = new Set(found.map((m) => m.id));
  const all = [
    ...found,
    ...mentioned
      .filter((m) => !ids.has(m.id))
      .map((m) => ({
        id: m.id, kind: m.kind, content: m.content, importance: m.importance, occurredAt: m.occurredAt, entryId: m.entryId,
        entities: m.entities.map((e) => e.entity.name), score: 0, parts: { sim: 0, recency: 0, importance: m.importance / 10, entity: 1 },
      })),
  ];
  // 从信件整理出的记忆不算候选：写给他的信已经在往来信件里，写给别人的信他看不到
  const fromLetters = new Set(
    (await db.entry.findMany({ where: { id: { in: all.flatMap((m) => (m.entryId ? [m.entryId] : [])) }, type: LETTER_ENTRY_TYPE }, select: { id: true } })).map((e) => e.id),
  );
  return all.filter((m) => !m.entryId || !fromLetters.has(m.entryId));
}

/** 事实自检：真实模型下核查无依据（越界）的说法并改写 */
export async function factCheck(body: string, facts: string, note = "") {
  if (isMock()) return { body, checkStatus: "unchecked", checked: "引用校验通过" };
  const check = await chatJson(z.object({ ok: z.boolean(), issues: z.array(z.string()).default([]) }), selfCheckMessages(body, facts, note), {
    mock: () => ({ ok: true, issues: [] }),
    temperature: 0,
  });
  if (!check.ok && check.issues.length) {
    const fixed = await chat(rewriteMessages(body, check.issues, facts), { temperature: 0.5, maxTokens: 1400, mock: () => body });
    return { body: fixed, checkStatus: "rewritten", checked: `已修正 ${check.issues.length} 处无依据表述` };
  }
  return { body, checkStatus: "passed", checked: "事实核查通过" };
}

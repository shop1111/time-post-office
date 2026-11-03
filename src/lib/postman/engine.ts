/**
 * 邮差引擎：快照 → 触发器候选 → 频控 → 检索记忆 → 模仿口吻写信 → 事实自检 → 投递
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { chat, isMock } from "@/lib/ai/provider";
import { chatJson } from "@/lib/ai/json";
import { letterMessages, rewriteMessages, selfCheckMessages } from "@/lib/ai/prompts";
import { mockLetter } from "@/lib/ai/mock";
import { now as clockNow } from "@/lib/clock";
import { retrieve, formatMemories, fmtDate, type RetrievedMemory } from "@/lib/memory/retrieve";
import { NOSTALGIA_WEIGHTS } from "@/lib/memory/rank";
import { getProfile, styleText } from "@/lib/memory/profile";
import { collectCandidates, type LetterCandidate, type Snapshot } from "./triggers";

const MIN_GAP_HOURS = 20; // 频控：AI 来信至少间隔 20 小时（虚拟时间）

export async function buildSnapshot(now: Date): Promise<Snapshot> {
  const [entries, memories, letters, entities] = await Promise.all([
    db.entry.findMany({ select: { id: true, occurredAt: true, mood: true, title: true, type: true } }),
    db.memory.findMany({ where: ACTIVE_MEMORY, include: { entities: { include: { entity: true } } } }),
    db.letter.findMany({ where: { triggerKey: { not: null } }, select: { triggerKey: true } }),
    db.entity.findMany({ include: { _count: { select: { memories: { where: { memory: ACTIVE_MEMORY } } } } } }),
  ]);
  return {
    now,
    entries,
    memories: memories.map((m) => ({
      id: m.id,
      entryId: m.entryId,
      kind: m.kind,
      content: m.content,
      importance: m.importance,
      occurredAt: m.occurredAt,
      dueAt: m.dueAt,
      resolved: m.resolved,
      entities: m.entities.map((e) => e.entity.name),
    })),
    sentKeys: new Set(letters.map((l) => l.triggerKey!)),
    entityFreq: entities.map((e) => ({ name: e.name, type: e.type, count: e._count.memories })),
  };
}

export interface TickResult {
  now: Date;
  delivered: string[];
  generated: string[];
  candidates: Array<Pick<LetterCandidate, "key" | "type" | "sender" | "priority" | "reason">>;
  skippedByRateLimit: boolean;
}

/** 一次邮差巡检。maxLetters 用于「时光快进」时一次多送几封 */
export async function tick(opts: { maxLetters?: number; ignoreGap?: boolean } = {}): Promise<TickResult> {
  const now = await clockNow();
  // 1. 投递到期的信（包括用户写给未来的时间胶囊）
  const due = await db.letter.findMany({ where: { deliveredAt: null, scheduledAt: { lte: now } } });
  for (const l of due) await db.letter.update({ where: { id: l.id }, data: { deliveredAt: now } });

  // 2. 频控
  const lastAi = await db.letter.findFirst({ where: { sender: { not: "user" }, deliveredAt: { not: null } }, orderBy: { deliveredAt: "desc" } });
  const gapOk = opts.ignoreGap || !lastAi?.deliveredAt || now.getTime() - lastAi.deliveredAt.getTime() >= MIN_GAP_HOURS * 3_600_000;

  const snapshot = await buildSnapshot(now);
  const candidates = collectCandidates(snapshot);
  const generated: string[] = [];
  if (gapOk) {
    // 同一类型一次只写一封，保证多样
    const usedTypes = new Set<string>();
    for (const c of candidates) {
      if (generated.length >= (opts.maxLetters ?? 1)) break;
      if (usedTypes.has(c.type)) continue;
      usedTypes.add(c.type);
      const letter = await writeLetter(c, now);
      generated.push(letter.id);
    }
  }
  return {
    now,
    delivered: due.map((d) => d.id),
    generated,
    candidates: candidates.slice(0, 8).map(({ key, type, sender, priority, reason }) => ({ key, type, sender, priority: Math.round(priority * 100) / 100, reason })),
    skippedByRateLimit: !gapOk,
  };
}

const LetterSchema = z.object({
  subject: z.string().min(1).max(40),
  body: z.string().min(40).max(1500),
  cited: z.array(z.string()).default([]),
});

export async function writeLetter(c: LetterCandidate, now: Date) {
  const profile = await getProfile();
  const { style, desc } = await styleText();

  // 锚点记忆 + 语义检索补充；「过去的你」只能看到写信那天之前的记忆
  const anchors = (await db.memory.findMany({ where: { id: { in: c.anchorMemoryIds }, ...ACTIVE_MEMORY }, include: { entities: { include: { entity: true } } } })).sort(
    (a, b) => c.anchorMemoryIds.indexOf(a.id) - c.anchorMemoryIds.indexOf(b.id),
  );
  const extra = await retrieve({
    query: c.query || c.reason,
    now,
    k: 5,
    entities: c.entities,
    weights: NOSTALGIA_WEIGHTS,
    before: c.sender === "past_self" ? new Date(c.writtenAt.getTime() + 86_400_000) : undefined,
  });
  const anchorMems: RetrievedMemory[] = anchors.map((a) => ({
    id: a.id, kind: a.kind, content: a.content, importance: a.importance, occurredAt: a.occurredAt, entryId: a.entryId,
    entities: a.entities.map((e) => e.entity.name), score: 99, parts: { sim: 1, recency: 0, importance: a.importance / 10, entity: 1 },
  }));
  const mems = [...anchorMems, ...extra.filter((e) => !c.anchorMemoryIds.includes(e.id))].slice(0, 7);
  const memText = formatMemories(mems);

  const draft = await chatJson(
    LetterSchema,
    letterMessages({
      sender: c.sender,
      reason: c.reason,
      today: fmtDate(now),
      writtenAt: fmtDate(c.writtenAt),
      memories: memText,
      style: desc,
      profile: profile.summary,
      name: profile.name,
    }),
    {
      temperature: 0.85,
      maxTokens: 1400,
      mock: () => mockLetter({ sender: c.sender, reason: c.reason, memories: mems, style, name: profile.name, writtenAt: c.writtenAt, today: now }),
    },
  );

  // 事实自检：引用必须真实存在；真实模型下再做一次「无依据说法」核查与改写
  const validIds = new Set(mems.map((m) => m.id));
  let cited = draft.cited.filter((id) => validIds.has(id));
  if (!cited.length) cited = c.anchorMemoryIds.filter((id) => validIds.has(id));
  let body = draft.body;
  let checked = "引用校验通过";
  if (!isMock()) {
    const check = await chatJson(z.object({ ok: z.boolean(), issues: z.array(z.string()).default([]) }), selfCheckMessages(body, memText), {
      mock: () => ({ ok: true, issues: [] }),
      temperature: 0,
    });
    if (!check.ok && check.issues.length) {
      body = await chat(rewriteMessages(body, check.issues, memText), { temperature: 0.5, maxTokens: 1400, mock: () => body });
      checked = `已修正 ${check.issues.length} 处无依据表述`;
    } else checked = "事实核查通过";
  }

  return db.letter.create({
    data: {
      sender: c.sender,
      subject: draft.subject,
      body: body.trim(),
      triggerType: c.type,
      triggerKey: c.key,
      reason: `${c.reason}。（${checked}）`,
      citedMemoryIds: JSON.stringify(cited),
      writtenAt: c.writtenAt,
      scheduledAt: now,
      deliveredAt: now,
    },
  });
}

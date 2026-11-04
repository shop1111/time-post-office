/**
 * 小局的信箱：投递到期的信 → 代笔回信 → 触发器候选 → 频控 → 检索记忆 → 写信 → 事实自检 → 投递
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { chatJson } from "@/lib/ai/json";
import { letterMessages } from "@/lib/ai/prompts";
import { CURATOR_SENDERS, loadCuratorContext, rememberSelf, renderCuratorContext } from "@/lib/curator/context";
import { planLetter } from "@/lib/curator/planner";
import { polishCuratorLetter } from "@/lib/curator/letters";
import { mockCuratorLetter } from "@/lib/ai/mock";
import { now as clockNow } from "@/lib/clock";
import { retrieve, formatMemories, fmtDate, type RetrievedMemory } from "@/lib/memory/retrieve";
import { NOSTALGIA_WEIGHTS } from "@/lib/memory/rank";
import { getProfile, styleText } from "@/lib/memory/profile";
import { ensureSystemCorrespondents } from "@/lib/correspondents";
import { CAPSULE_WHERE } from "@/lib/capsules";
import { collectCandidates, type LetterCandidate, type Snapshot } from "./triggers";
import { factCheck, processDueReplies } from "./reply";

const MIN_GAP_HOURS = 20; // 频控：小局主动来信至少间隔 20 小时

export async function buildSnapshot(now: Date): Promise<Snapshot> {
  const [entries, memories, letters, entities, sent, lastCurator] = await Promise.all([
    db.entry.findMany({ where: CAPSULE_WHERE, select: { id: true, occurredAt: true, mood: true, title: true, type: true } }),
    db.memory.findMany({ where: ACTIVE_MEMORY, include: { entities: { include: { entity: true } } } }),
    db.letter.findMany({ where: { triggerKey: { not: null } }, select: { triggerKey: true } }),
    db.entity.findMany({ include: { _count: { select: { memories: { where: { memory: ACTIVE_MEMORY } } } } } }),
    db.letter.findMany({
      where: { sender: "user", correspondent: { kind: { not: "future_self" } } },
      orderBy: { writtenAt: "desc" },
      take: 20,
      include: { correspondent: { select: { name: true } } },
    }),
    db.letter.findFirst({ where: { sender: { in: CURATOR_SENDERS }, deliveredAt: { not: null } }, orderBy: { deliveredAt: "desc" } }),
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
    sentLetters: sent.map((l) => ({ id: l.id, to: l.correspondent?.name ?? "某人", subject: l.subject, body: l.body, writtenAt: l.writtenAt })),
    lastCuratorAt: lastCurator?.deliveredAt ?? null,
  };
}

export interface TickResult {
  now: Date;
  delivered: string[];
  generated: string[];
  /** 新送达的代笔回信 */
  replies: string[];
  candidates: Array<Pick<LetterCandidate, "key" | "type" | "sender" | "priority" | "reason">>;
  skippedByRateLimit: boolean;
}

/** 打开页面时的一次检查。ignoreGap 用于设置页「让小局现在写一封信」 */
export async function tick(opts: { maxLetters?: number; ignoreGap?: boolean } = {}): Promise<TickResult> {
  const now = await clockNow();
  // 1. 投递到期的信（写给未来自己的信）
  const due = await db.letter.findMany({ where: { deliveredAt: null, scheduledAt: { lte: now } } });
  for (const l of due) await db.letter.update({ where: { id: l.id }, data: { deliveredAt: now } });

  // 2. 到时间的代笔回信（不受频控）
  const replies = await processDueReplies(now);

  // 3. 小局主动来信的频控
  const lastAi = await db.letter.findFirst({ where: { sender: { in: CURATOR_SENDERS }, deliveredAt: { not: null } }, orderBy: { deliveredAt: "desc" } });
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
    replies,
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
  const { style } = await styleText();
  const { curator } = await ensureSystemCorrespondents();

  // 锚点记忆 + 语义检索补充
  const anchors = (await db.memory.findMany({ where: { id: { in: c.anchorMemoryIds }, ...ACTIVE_MEMORY }, include: { entities: { include: { entity: true } } } })).sort(
    (a, b) => c.anchorMemoryIds.indexOf(a.id) - c.anchorMemoryIds.indexOf(b.id),
  );
  const extra = await retrieve({ query: c.query || c.reason, now, k: 5, entities: c.entities, weights: NOSTALGIA_WEIGHTS });
  const anchorMems: RetrievedMemory[] = anchors.map((a) => ({
    id: a.id, kind: a.kind, content: a.content, importance: a.importance, occurredAt: a.occurredAt, entryId: a.entryId,
    entities: a.entities.map((e) => e.entity.name), score: 99, parts: { sim: 1, recency: 0, importance: a.importance / 10, entity: 1 },
  }));
  const mems = [...anchorMems, ...extra.filter((e) => !c.anchorMemoryIds.includes(e.id))].slice(0, 7);
  const memText = formatMemories(mems);
  const ctx = await loadCuratorContext(now);
  const plan = planLetter({ type: c.type, stage: ctx.relationship.stage, seed: seedOf(c.key) });
  const mock = () => mockCuratorLetter({ type: c.type, reason: c.reason, memories: mems, style, name: profile.name, today: now, plan, world: ctx.world });

  const raw = await chatJson(
    LetterSchema,
    letterMessages({ reason: c.reason, today: fmtDate(now), memories: memText, profile: profile.summary, name: profile.name, curator: renderCuratorContext(ctx, profile.name, { letters: true }), plan }),
    { temperature: 0.9, maxTokens: 1400, mock },
  );
  // 去 AI 腔 + 输出防线
  const draft = await polishCuratorLetter(raw, mock);

  // 事实自检：引用必须真实存在；真实模型下再做一次「无依据说法」核查与改写
  const validIds = new Set(mems.map((m) => m.id));
  let cited = draft.cited.filter((id) => validIds.has(id));
  if (!cited.length) cited = c.anchorMemoryIds.filter((id) => validIds.has(id));
  const { body, checkStatus, checked } = await factCheck(draft.body, memText);

  const letter = await db.letter.create({
    data: {
      sender: "curator",
      correspondentId: curator.id,
      subject: draft.subject,
      body: body.trim(),
      triggerType: c.type,
      triggerKey: c.key,
      reason: `${c.reason}。（${checked}）`,
      checkStatus,
      checkNote: checked,
      citedMemoryIds: JSON.stringify(cited),
      writtenAt: now,
      scheduledAt: now,
      deliveredAt: now,
    },
  });
  await rememberSelf(letter.body, "letter", letter.id);
  return letter;
}

const seedOf = (s: string) => Array.from(s).reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 11);

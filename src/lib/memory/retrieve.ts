import { db } from "@/lib/db";
import { ACTIVE_MEMORY } from "./consistency";
import { embed, type CallOptions } from "@/lib/ai/provider";
import { fromBytes, toBytes } from "./embed-lite";
import { DEFAULT_WEIGHTS, mmr, scoreCandidates, type Candidate, type RankWeights } from "./rank";

export interface RetrievedMemory {
  id: string;
  kind: string;
  content: string;
  importance: number;
  occurredAt: Date;
  entryId: string | null;
  entities: string[];
  score: number;
  parts: { sim: number; recency: number; importance: number; entity: number };
}

/**
 * 混合检索：向量相似 + 时间衰减 + 重要度 + 实体重合 → MMR。
 * 向量缺失或维度不一致（切换过 embed 模式）时就地补算并回写。
 */
export async function retrieve(opts: {
  query: string;
  now: Date;
  k?: number;
  entities?: string[];
  weights?: RankWeights;
  before?: Date;
  excludeEntryId?: string;
  kinds?: string[];
  touch?: boolean;
  onExecution?: CallOptions["onExecution"];
}): Promise<RetrievedMemory[]> {
  const rows = await db.memory.findMany({
    where: {
      ...ACTIVE_MEMORY,
      ...(opts.before ? { occurredAt: { lt: opts.before } } : {}),
      ...(opts.before ? { OR: [{ entryId: null }, { entry: { occurredAt: { lt: opts.before } } }] } : {}),
      ...(opts.excludeEntryId ? { NOT: { entryId: opts.excludeEntryId } } : {}),
      ...(opts.kinds ? { kind: { in: opts.kinds } } : {}),
    },
    include: { entities: { include: { entity: true } } },
  });
  if (!rows.length) return [];

  const [qvec] = await embed([opts.query], { onExecution: opts.onExecution });
  const stale = rows.filter((r) => {
    const v = fromBytes(r.embedding);
    return !v || v.length !== qvec.length;
  });
  if (stale.length) {
    const vecs = await embed(stale.map((r) => r.content), { onExecution: opts.onExecution });
    await Promise.all(stale.map((r, i) => db.memory.updateMany({
      where: { id: r.id, ...ACTIVE_MEMORY, userEdited: false, revision: r.revision },
      data: { embedding: toBytes(vecs[i]) },
    })));
    stale.forEach((r, i) => (r.embedding = toBytes(vecs[i]) as never));
  }

  // 模型等待期间可能被更正、撤回或删除；本轮不再使用旧版本。
  // 人工编辑过的有效记忆仍可检索，但补算向量仅用于本次排序，不回写。
  const current = await db.memory.findMany({ where: { id: { in: rows.map((r) => r.id) }, ...ACTIVE_MEMORY }, select: { id: true, revision: true } });
  const revisions = new Map(current.map((r) => [r.id, r.revision]));
  const cands: (Candidate & { row: (typeof rows)[number] })[] = rows.filter((r) => revisions.get(r.id) === r.revision).map((r) => ({
    id: r.id,
    content: r.content,
    importance: r.importance,
    occurredAt: r.occurredAt,
    vec: fromBytes(r.embedding),
    entityNames: r.entities.map((e) => e.entity.name),
    row: r,
  }));

  const scored = scoreCandidates(cands, { vec: qvec, entities: opts.entities ?? [], now: opts.now }, opts.weights ?? DEFAULT_WEIGHTS);
  const top = mmr(scored, opts.k ?? 6);

  if (opts.touch !== false && top.length) {
    await db.memory.updateMany({
      where: { ...ACTIVE_MEMORY, userEdited: false, OR: top.map((t) => ({ id: t.item.id, revision: t.item.row.revision })) },
      data: { lastRecalledAt: opts.now, recallCount: { increment: 1 } },
    });
  }

  return top.map((t) => ({
    id: t.item.id,
    kind: t.item.row.kind,
    content: t.item.content,
    importance: t.item.importance,
    occurredAt: t.item.occurredAt,
    entryId: t.item.row.entryId,
    entities: t.item.entityNames,
    score: Math.round(t.score * 1000) / 1000,
    parts: t.parts,
  }));
}

export function formatMemories(ms: RetrievedMemory[]): string {
  if (!ms.length) return "（暂无相关记忆）";
  return ms.map((m) => `[${m.id}] ${fmtDate(m.occurredAt)} · ${m.content}`).join("\n");
}

export function fmtDate(d: Date) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 记忆检索打分（参考 Generative Agents）：
 *   score = w.sim·语义相似 + w.recency·时间衰减 + w.importance·重要度 + w.entity·实体重合
 * 然后用 MMR（最大边际相关）去重，避免几条几乎一样的记忆挤满上下文。
 * 纯函数，便于单测与调参。
 */
import { cosine } from "./embed-lite";

export interface Candidate {
  id: string;
  content: string;
  importance: number; // 1-10
  occurredAt: Date;
  vec: Float32Array | null;
  entityNames: string[];
}

export interface RankWeights {
  sim: number;
  recency: number;
  importance: number;
  entity: number;
  halfLifeDays: number;
}

export const DEFAULT_WEIGHTS: RankWeights = { sim: 1, recency: 0.35, importance: 0.45, entity: 0.5, halfLifeDays: 45 };
/** 回顾往事时：弱化新近性，更看重重要度 */
export const NOSTALGIA_WEIGHTS: RankWeights = { sim: 1, recency: 0.05, importance: 0.7, entity: 0.6, halfLifeDays: 365 };

export interface Scored<T extends Candidate = Candidate> {
  item: T;
  score: number;
  parts: { sim: number; recency: number; importance: number; entity: number };
}

export function scoreCandidates<T extends Candidate>(
  cands: T[],
  query: { vec: Float32Array | null; entities: string[]; now: Date },
  w: RankWeights = DEFAULT_WEIGHTS,
): Scored<T>[] {
  return cands.map((c) => {
    const sim = query.vec && c.vec ? Math.max(0, cosine(query.vec, c.vec)) : 0;
    const days = Math.max(0, (query.now.getTime() - c.occurredAt.getTime()) / 86_400_000);
    const recency = Math.pow(0.5, days / w.halfLifeDays);
    const importance = Math.min(10, Math.max(1, c.importance)) / 10;
    const hit = query.entities.length
      ? query.entities.filter((e) => c.entityNames.includes(e) || c.content.includes(e)).length / query.entities.length
      : 0;
    const parts = { sim, recency, importance, entity: hit };
    const score = w.sim * sim + w.recency * recency + w.importance * importance + w.entity * hit;
    return { item: c, score, parts };
  });
}

/** MMR：lambda 越大越看重相关性，越小越看重多样性 */
export function mmr<T extends Candidate>(scored: Scored<T>[], k: number, lambda = 0.72): Scored<T>[] {
  const pool = [...scored].sort((a, b) => b.score - a.score);
  const picked: Scored<T>[] = [];
  const maxScore = pool[0]?.score || 1;
  while (picked.length < k && pool.length) {
    let bestIdx = 0;
    let best = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      const redundancy = picked.length
        ? Math.max(...picked.map((p) => (p.item.vec && c.item.vec ? cosine(p.item.vec, c.item.vec) : 0)))
        : 0;
      const v = lambda * (c.score / maxScore) - (1 - lambda) * redundancy;
      if (v > best) {
        best = v;
        bestIdx = i;
      }
    }
    picked.push(pool.splice(bestIdx, 1)[0]);
  }
  return picked;
}

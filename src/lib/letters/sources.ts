import { db, parseJson } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { z } from "zod";
import type { CheckStatus, LetterSource, LetterSourcesResponse } from "@/lib/types";

const Snapshots = z.array(z.object({ memoryId: z.string(), entryId: z.string().nullable(), content: z.string(), occurredAt: z.string().datetime() }));
const CHECK_STATUS: CheckStatus[] = ["passed", "rewritten", "unchecked", "failed"];
const STOP = new Set(["那天", "今天", "后来", "自己", "时候", "记得", "真的", "生活", "觉得", "一个", "你说", "我说", "我们", "已经", "现在"]);

/** 切分只取原字符串切片，保留空格、换行、引号、标点和emoji，拼接严格等于body。 */
export function splitLetterBody(body: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (!/[。！？!?；;\n.]/.test(body[i])) continue;
    if (body[i] === "." && /\d/.test(body[i - 1] ?? "") && /\d/.test(body[i + 1] ?? "")) continue;
    let end = i + 1;
    while (end < body.length && /[。！？!?；;\r\n.”’」』"]/.test(body[end])) end++;
    parts.push(body.slice(start, end)); start = end; i = end - 1;
  }
  if (start < body.length) parts.push(body.slice(start));
  return parts;
}
const normalize = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]/gu) ?? []).join("");
const grams = (text: string) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2)).filter((gram) => !STOP.has(gram)));

/** 字符依据匹配，不做语义推断：至少连续6字、5个二元组，句/原文覆盖≥35%/50%。 */
export function sourceScore(sentence: string, excerpt: string): number {
  const a = normalize(sentence), b = normalize(excerpt);
  if (a.length < 6 || b.length < 6) return 0;
  let contiguous = false;
  for (let i = 0; i <= b.length - 6; i++) if (a.includes(b.slice(i, i + 6))) { contiguous = true; break; }
  if (!contiguous) return 0;
  const left = grams(a), right = grams(b);
  const common = [...left].filter((gram) => right.has(gram)).length;
  if (common < 5 || common / left.size < 0.35 || common / right.size < 0.5) return 0;
  return 2 * common / (left.size + right.size);
}

export async function letterSources(letterId: string): Promise<LetterSourcesResponse | null> {
  const letter = await db.letter.findUnique({ where: { id: letterId } });
  if (!letter) return null;
  const raw = parseJson<unknown>(letter.citedSnapshot, null);
  const parsed = Snapshots.safeParse(raw);
  const snapshots = parsed.success ? parsed.data : [];
  let sources: LetterSource[] = [];
  if (snapshots.length) {
    const current = await db.memory.findMany({ where: { id: { in: snapshots.map((snapshot) => snapshot.memoryId) } }, select: { id: true, content: true, status: true } });
    const byId = new Map(current.map((row) => [row.id, row]));
    sources = [...new Map(snapshots.map((snapshot) => {
      const row = byId.get(snapshot.memoryId);
      return [snapshot.memoryId, { memoryId: snapshot.memoryId, entryId: snapshot.entryId, date: snapshot.occurredAt, excerpt: snapshot.content,
        state: !row || row.status !== "active" ? "withdrawn" : row.content === snapshot.content ? "current" : "corrected" } satisfies LetterSource];
    })).values()];
  } else if (parsed.success && !snapshots.length) {
    // 只有明确的空快照才按旧信件处理；损坏快照不冒充有效原文。
    const ids = parseJson<unknown>(letter.citedMemoryIds, []);
    const rows = await db.memory.findMany({ where: { id: { in: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [] }, ...ACTIVE_MEMORY } });
    sources = rows.map((row) => ({ memoryId: row.id, entryId: row.entryId, date: row.occurredAt.toISOString(), excerpt: row.content, state: "current" }));
  }
  return {
    letterId, checkStatus: CHECK_STATUS.includes(letter.checkStatus as CheckStatus) ? letter.checkStatus as CheckStatus : "unchecked", checkNote: letter.checkNote,
    sentences: splitLetterBody(letter.body).map((text) => ({ text, sources: sources.map((source) => ({ source, score: sourceScore(text, source.excerpt) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 2)
      .map(({ source }) => (source.state === "withdrawn" ? { ...source, excerpt: "" } : source)) })),
  };
}

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db, parseJson } from "@/lib/db";
import { embed, type CallOptions } from "@/lib/ai/provider";
import { chatJson } from "@/lib/ai/json";
import { extractMessages } from "@/lib/ai/prompts";
import { extractHeuristic } from "./heuristics";
import { toBytes } from "./embed-lite";
import { fmtDate } from "./retrieve";
import { refreshProfile } from "./profile";
import { ACTIVE_MEMORY, invalidateDerived } from "./consistency";
import type { EntityType, Extraction, MemoryKind } from "@/lib/types";

const KINDS = ["event", "fact", "person", "place", "goal", "plan", "preference"] as const;

export const ExtractionSchema = z.object({
  title: z.string().min(1).max(30),
  summary: z.string().max(300),
  mood: z.coerce.number().min(-1).max(1),
  emotions: z.array(z.string()).max(6).default([]),
  place: z.string().nullish(),
  memories: z
    .array(
      z.object({
        kind: z.enum(KINDS).catch("event"),
        content: z.string().min(2).max(160),
        importance: z.coerce.number().int().min(1).max(10).catch(5),
        dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().catch(null),
        entities: z.array(z.object({ name: z.string().min(1).max(20), type: z.enum(["person", "place", "theme"]).catch("theme") })).default([]),
      }),
    )
    .min(1)
    .max(8),
});

/**
 * 记录 → 结构化记忆 → 向量 + 实体图谱 → 更新画像
 */
export async function extractEntry(entryId: string, options: CallOptions = {}): Promise<Extraction> {
  const entry = await db.entry.findUniqueOrThrow({ where: { id: entryId }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  const known = await db.entity.findMany({ select: { name: true, type: true }, take: 200, orderBy: { createdAt: "desc" } });
  const conversation = entry.messages.map((m) => `${m.role === "user" ? "用户" : "AI"}：${m.content}`).join("\n");
  const userWords = entry.messages.filter((m) => m.role === "user").map((m) => m.content).join("。");
  const fullText = [entry.text, entry.transcript && entry.transcript !== entry.text ? entry.transcript : ""].filter(Boolean).join("。");

  const extraction: Extraction = await chatJson(
    ExtractionSchema,
    extractMessages({
      date: fmtDate(entry.occurredAt),
      text: fullText,
      caption: entry.visionCaption,
      place: entry.place,
      conversation,
      known: known.map((k) => k.name).join("、"),
    }),
    {
      ...options,
      mock: () =>
        extractHeuristic(
          { text: [fullText, userWords].filter(Boolean).join("。"), place: entry.place, occurredAt: entry.occurredAt, caption: entry.visionCaption },
          known as Array<{ name: string; type: EntityType }>,
        ),
    },
  );

  return extraction;
}

export async function readEntryState(entryId: string, client: Prisma.TransactionClient = db) {
  return client.entry.findUniqueOrThrow({ where: { id: entryId }, include: {
    memories: { include: { entities: { include: { entity: true } } }, orderBy: { createdAt: "asc" } },
  } });
}

/** 旧记录没有检查点时，只从已保存字段恢复展示结果，绝不重新抽取。 */
export function savedExtraction(entry: Awaited<ReturnType<typeof readEntryState>>): Extraction {
  return {
    title: entry.title ?? "已保存的记录", summary: entry.summary ?? "", mood: entry.mood ?? 0,
    emotions: parseJson<string[]>(entry.emotions, []), place: entry.place,
    memories: entry.memories.filter((m) => m.status === ACTIVE_MEMORY.status).map((m) => ({
      kind: m.kind as MemoryKind, content: m.content, importance: m.importance,
      dueDate: m.dueAt?.toISOString().slice(0, 10) ?? null,
      entities: m.entities.map(({ entity }) => ({ name: entity.name, type: entity.type as EntityType })),
    })),
  };
}

const activeIds = (entry: Awaited<ReturnType<typeof readEntryState>>) => entry.memories.filter((m) => m.status === ACTIVE_MEMORY.status).map((m) => m.id);

export interface PersistedEntry { extraction: Extraction; memoryIds: string[] }
/** 保存事务内再次检查终态；保存后不删除、不更新已有记忆。检查点也必须在本事务落库。 */
export async function persistEntry(
  entryId: string,
  extraction: Extraction,
  vectors: Float32Array[],
  checkpoint?: (tx: Prisma.TransactionClient, saved: PersistedEntry) => Promise<void>,
): Promise<PersistedEntry> {
  return db.$transaction(async (tx) => {
    const entry = await readEntryState(entryId, tx);
    if (entry.interviewDone || entry.memories.length) {
      const saved = { extraction: savedExtraction(entry), memoryIds: activeIds(entry) };
      await checkpoint?.(tx, saved);
      return saved;
    }
    if (vectors.length !== extraction.memories.length) throw new Error("Embedding count mismatch");
    const memoryIds: string[] = [];
    for (let i = 0; i < extraction.memories.length; i++) {
      const memory = extraction.memories[i];
      const row = await tx.memory.create({ data: {
        entryId, kind: memory.kind, content: memory.content, importance: memory.importance,
        ...ACTIVE_MEMORY, userEdited: false,
        occurredAt: entry.occurredAt, dueAt: memory.dueDate ? new Date(`${memory.dueDate}T12:00:00`) : null,
        embedding: toBytes(vectors[i]),
      } });
      memoryIds.push(row.id);
      const entities = new Map(memory.entities.map((e) => [`${e.type}:${e.name}`, e]));
      for (const entity of entities.values()) {
        const found = await tx.entity.upsert({ where: { name_type: entity }, update: {}, create: entity });
        await tx.memoryEntity.create({ data: { memoryId: row.id, entityId: found.id } });
      }
    }
    await tx.entry.update({ where: { id: entryId }, data: {
      title: extraction.title, summary: extraction.summary, mood: extraction.mood,
      emotions: JSON.stringify(extraction.emotions), place: entry.place ?? extraction.place ?? null, interviewDone: true,
    } });
    // 只在真正新增时失效一次；与记忆和任务检查点原子提交，后续画像阶段负责重建。
    if (memoryIds.length) await invalidateDerived({ entryId, memoryIds, reason: "memory_created" }, tx);
    const saved = { extraction, memoryIds };
    await checkpoint?.(tx, saved);
    return saved;
  });
}

/** 兼容回信调用；finalize 的五阶段任务由 jobs.ts 编排。 */
export async function processEntry(entryId: string) {
  const entry = await readEntryState(entryId);
  let extraction: Extraction;
  let memoryIds: string[];
  if (entry.interviewDone || entry.memories.length) {
    extraction = savedExtraction(entry);
    memoryIds = activeIds(entry);
  } else {
    const extracted = await extractEntry(entryId);
    const vectors = await embed(extracted.memories.map((m) => m.content));
    ({ extraction, memoryIds } = await persistEntry(entryId, extracted, vectors));
  }
  await refreshProfile().catch(() => console.warn("[profile] 更新失败"));
  const memories = await db.memory.findMany({ where: { id: { in: memoryIds }, ...ACTIVE_MEMORY }, include: { entities: { include: { entity: true } } } });
  return { extraction, memories };
}

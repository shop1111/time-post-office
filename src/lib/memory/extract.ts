import { z } from "zod";
import { db } from "@/lib/db";
import { embed } from "@/lib/ai/provider";
import { chatJson } from "@/lib/ai/json";
import { extractMessages } from "@/lib/ai/prompts";
import { extractHeuristic } from "./heuristics";
import { toBytes } from "./embed-lite";
import { fmtDate } from "./retrieve";
import { refreshProfile } from "./profile";
import type { EntityType, Extraction } from "@/lib/types";

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
export async function processEntry(entryId: string) {
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
      mock: () =>
        extractHeuristic(
          { text: [fullText, userWords].filter(Boolean).join("。"), place: entry.place, occurredAt: entry.occurredAt, caption: entry.visionCaption },
          known as Array<{ name: string; type: EntityType }>,
        ),
    },
  );

  const vecs = await embed(extraction.memories.map((m) => m.content));

  const memoryIds = await db.$transaction(async (tx) => {
    await tx.memory.deleteMany({ where: { entryId, userEdited: false } });
    const ids: string[] = [];
    for (let i = 0; i < extraction.memories.length; i++) {
      const m = extraction.memories[i];
      const mem = await tx.memory.create({
        data: {
          entryId,
          kind: m.kind,
          content: m.content,
          importance: m.importance,
          occurredAt: entry.occurredAt,
          dueAt: m.dueDate ? new Date(`${m.dueDate}T12:00:00`) : null,
          embedding: toBytes(vecs[i]),
        },
      });
      ids.push(mem.id);
      const uniq = new Map(m.entities.map((e) => [`${e.type}:${e.name}`, e]));
      for (const e of uniq.values()) {
        const ent = await tx.entity.upsert({
          where: { name_type: { name: e.name, type: e.type } },
          update: {},
          create: { name: e.name, type: e.type },
        });
        await tx.memoryEntity.create({ data: { memoryId: mem.id, entityId: ent.id } });
      }
    }
    await tx.entry.update({
      where: { id: entryId },
      data: {
        title: extraction.title,
        summary: extraction.summary,
        mood: extraction.mood,
        emotions: JSON.stringify(extraction.emotions),
        place: entry.place ?? extraction.place ?? null,
        interviewDone: true,
      },
    });
    return ids;
  });

  await refreshProfile().catch((e) => console.error("[profile] 更新失败", e));

  const memories = await db.memory.findMany({ where: { id: { in: memoryIds } }, include: { entities: { include: { entity: true } } } });
  return { extraction, memories };
}

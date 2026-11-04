import { z } from "zod";
import { db } from "@/lib/db";
import { embed } from "@/lib/ai/provider";
import { toBytes } from "./embed-lite";
import { getDerivedRevision, invalidateDerived, PROFILE_REVISION_KEY } from "./consistency";

const EntitySchema = z.object({
  name: z.string().trim().min(1, "关联名称不能为空").max(20, "关联名称最多 20 字"),
  type: z.enum(["person", "place", "theme"]),
}).strict();

export const CorrectMemorySchema = z.object({
  expectedRevision: z.number().int().min(0),
  content: z.string().trim().min(2, "记忆至少填写 2 字").max(160, "记忆最多 160 字").optional(),
  importance: z.number({ invalid_type_error: "重要度需为 1–10 的整数" }).int("重要度需为整数").min(1, "重要度最低为 1").max(10, "重要度最高为 10").optional(),
  entities: z.array(EntitySchema).max(20, "每条记忆最多 20 个关联").optional(),
}).strict().refine((input) => input.content !== undefined || input.importance !== undefined || input.entities !== undefined, {
  message: "请提供要更正的内容、重要度或关联",
});

export const RetractMemorySchema = z.object({ expectedRevision: z.number().int().min(0).optional() }).strict();

export class MemoryManagementError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "MemoryManagementError";
  }
}

const includeEntities = { entities: { include: { entity: true } } } as const;

/** Compute embeddings outside the transaction, then compare-and-swap user edits. */
export async function correctMemory(id: string, raw: unknown) {
  const input = CorrectMemorySchema.parse(raw);
  const previous = await db.memory.findUnique({ where: { id } });
  if (!previous) throw new MemoryManagementError(404, "这条记忆不存在");
  if (previous.status !== "active") throw new MemoryManagementError(409, "这条记忆已撤回，不能继续更正");
  if (previous.revision !== input.expectedRevision) throw new MemoryManagementError(409, "记忆已被更新，你的草稿已保留，请查看最新版本后重试");
  const vector = input.content !== undefined && input.content !== previous.content
    ? (await embed([input.content]))[0] : undefined;
  if (input.content !== undefined && input.content !== previous.content && (!vector || !vector.length || !vector.every(Number.isFinite))) {
    throw new Error("未能生成有效向量，请重试");
  }

  return db.$transaction(async (tx) => {
    const changed = await tx.memory.updateMany({
      where: { id, status: "active", revision: input.expectedRevision },
      data: {
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.importance !== undefined ? { importance: input.importance } : {}),
        ...(vector ? { embedding: toBytes(vector) } : {}),
        userEdited: true, revision: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new MemoryManagementError(409, "记忆已被更新或撤回，你的草稿已保留，请查看最新版本后重试");

    if (input.entities !== undefined) {
      await tx.memoryEntity.deleteMany({ where: { memoryId: id } });
      const unique = new Map(input.entities.map((e) => [JSON.stringify([e.type, e.name]), e]));
      for (const entity of unique.values()) {
        const row = await tx.entity.upsert({ where: { name_type: entity }, create: entity, update: {} });
        await tx.memoryEntity.create({ data: { memoryId: id, entityId: row.id } });
      }
      // Retained links on retracted memories preserve provenance and shared entities.
      await tx.entity.deleteMany({ where: { memories: { none: {} } } });
    }
    const { derivedRevision } = await invalidateDerived({ memoryIds: [id], reason: "memory_corrected" }, tx);
    const memory = await tx.memory.findUniqueOrThrow({ where: { id }, include: includeEntities });
    return { memory, derivedRevision, profilePending: true };
  });
}

/** Bodyless DELETE remains compatible with the existing record-page button. */
export async function retractMemory(id: string, raw: unknown = {}) {
  const input = RetractMemorySchema.parse(raw);
  return db.$transaction(async (tx) => {
    const current = await tx.memory.findUnique({ where: { id }, include: includeEntities });
    if (!current) throw new MemoryManagementError(404, "这条记忆不存在");
    if (current.status === "retracted") {
      const derivedRevision = await getDerivedRevision(tx);
      const built = await tx.setting.findUnique({ where: { key: PROFILE_REVISION_KEY } });
      return { memory: current, derivedRevision, profilePending: built?.value !== String(derivedRevision) };
    }
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
      throw new MemoryManagementError(409, "记忆已被更新，请查看最新内容后再撤回");
    }
    const changed = await tx.memory.updateMany({
      where: { id, revision: current.revision, status: "active" },
      data: { status: "retracted", userEdited: true, revision: { increment: 1 }, retractedAt: new Date() },
    });
    if (changed.count !== 1) throw new MemoryManagementError(409, "记忆已被更新，请刷新后重试");
    const { derivedRevision } = await invalidateDerived({ memoryIds: [id], reason: "memory_retracted" }, tx);
    const memory = await tx.memory.findUniqueOrThrow({ where: { id }, include: includeEntities });
    return { memory, derivedRevision, profilePending: true };
  });
}

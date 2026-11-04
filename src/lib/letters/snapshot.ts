import type { Prisma } from "@prisma/client";
import type { RetrievedMemory } from "@/lib/memory/retrieve";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";

export interface CitedSnapshot { memoryId: string; entryId: string | null; content: string; occurredAt: string }
/** 必须在写信事务内核对，引用内容来自数据库，不接受模型生成的摘录。 */
export async function verifiedSnapshots(tx: Prisma.TransactionClient, ids: string[], context: RetrievedMemory[]) {
  const rows = await tx.memory.findMany({ where: { id: { in: ids }, ...ACTIVE_MEMORY }, select: { id: true, entryId: true, content: true, occurredAt: true } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const original = new Map(context.map((row) => [row.id, row]));
  const snapshots: CitedSnapshot[] = [];
  for (const id of new Set(ids)) {
    const row = byId.get(id); const seen = original.get(id);
    if (row && seen && row.content === seen.content && row.entryId === seen.entryId && row.occurredAt.getTime() === seen.occurredAt.getTime()) {
      snapshots.push({ memoryId: id, entryId: row.entryId, content: row.content, occurredAt: row.occurredAt.toISOString() });
    }
  }
  return { snapshots, changed: snapshots.length !== new Set(ids).size };
}

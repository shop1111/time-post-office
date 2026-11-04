import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { MemoryList } from "@/components/memory/MemoryList";

export default async function ManageMemoryPage() {
  const memories = await db.memory.findMany({
    orderBy: { occurredAt: "desc" },
    include: { entities: { include: { entity: true } } },
  });

  return (
    <div className="space-y-6">
      <header>
        <Link href="/memory" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
          <ArrowLeft size={14} /> 返回记忆
        </Link>
        <h1 className="mt-3 font-hand text-3xl">记忆管理</h1>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          你可以更正记忆，也可以撤回它。小局不再把撤回的记录作为有效长期记忆使用。原始胶囊、历史信件和撤回记录仍会保留。
        </p>
      </header>

      <MemoryList
        items={memories.map((m) => ({
          id: m.id,
          kind: m.kind,
          content: m.content,
          importance: m.importance,
          occurredAt: m.occurredAt.toISOString(),
          dueAt: m.dueAt?.toISOString() ?? null,
          resolved: m.resolved,
          entryId: m.entryId,
          recallCount: m.recallCount,
          userEdited: m.userEdited,
          status: m.status,
          revision: m.revision,
          retractedAt: m.retractedAt?.toISOString() ?? null,
          entities: m.entities.map((e) => ({ name: e.entity.name, type: e.entity.type as "person" | "place" | "theme" })),
        }))}
      />
    </div>
  );
}

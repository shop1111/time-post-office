import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db, parseJson } from "@/lib/db";
import { LetterView } from "@/components/LetterView";

export default async function LetterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = await db.letter.findUnique({ where: { id } });
  if (!l || !l.deliveredAt) notFound();
  const ids = parseJson<string[]>(l.citedMemoryIds, []);
  const cited = await db.memory.findMany({ where: { id: { in: ids } }, include: { entry: { select: { photoPath: true, title: true } } } });

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/mailbox" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft size={14} /> 信箱
      </Link>
      <LetterView
        l={{
          id: l.id,
          sender: l.sender,
          subject: l.subject,
          body: l.body,
          reason: l.reason,
          triggerType: l.triggerType,
          writtenAt: l.writtenAt.toISOString(),
          deliveredAt: l.deliveredAt.toISOString(),
          readAt: l.readAt?.toISOString() ?? null,
          reply: l.reply,
          repliedAt: l.repliedAt?.toISOString() ?? null,
        }}
        cited={cited.map((m) => ({ id: m.id, content: m.content, occurredAt: m.occurredAt.toISOString(), entryId: m.entryId, photoPath: m.entry?.photoPath ?? null, title: m.entry?.title ?? null }))}
      />
    </div>
  );
}

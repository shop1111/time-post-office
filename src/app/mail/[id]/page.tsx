import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { db, parseJson } from "@/lib/db";
import { LetterView } from "@/components/LetterView";
import { fmtCN } from "@/lib/utils";
import type { LetterKnowledge } from "@/lib/types";

export default async function LetterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = await db.letter.findUnique({ where: { id }, include: { correspondent: true } });
  if (!l) notFound();

  // 写给未来自己的信：没到日子，信封是封着的
  if (!l.deliveredAt) {
    return (
      <div className="mx-auto max-w-2xl">
        <BackLink />
        <div className="card mt-6 p-8 text-center">
          <Lock className="mx-auto text-gold" />
          <h1 className="mt-3 font-hand text-2xl">{l.subject}</h1>
          <p className="mt-2 text-sm text-ink-2">
            这封信写于 {fmtCN(l.writtenAt)}，约好在 {fmtCN(l.scheduledAt)} 送达。到那天之前，它会一直封着。
          </p>
        </div>
      </div>
    );
  }

  const ids = parseJson<string[]>(l.citedMemoryIds, []);
  const [cited, inReplyTo, myReplies] = await Promise.all([
    db.memory.findMany({ where: { id: { in: ids } }, include: { entry: { select: { photoPath: true, title: true } } } }),
    l.inReplyToId ? db.letter.findUnique({ where: { id: l.inReplyToId }, select: { id: true, subject: true } }) : null,
    l.sender === "user" ? [] : db.letter.findMany({ where: { inReplyToId: l.id, sender: "user" }, orderBy: { writtenAt: "asc" } }),
  ]);
  const knowledge = parseJson<LetterKnowledge | null>(l.knowledge, null);

  return (
    <div className="mx-auto max-w-2xl">
      <BackLink />
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
          kind: l.correspondent?.kind ?? null,
          name: l.correspondent?.name ?? null,
          correspondentId: l.correspondentId,
          knowledge: knowledge && Array.isArray(knowledge.known) ? knowledge : null,
          inReplyTo,
          replyState: l.sender === "user" && l.replyDueAt ? { pending: !l.replyLetterId || l.replyLetterId.startsWith("pending:"), letterId: l.replyLetterId } : null,
          myReplies: myReplies.map((r) => ({ id: r.id, subject: r.subject, body: r.body, writtenAt: r.writtenAt.toISOString() })),
        }}
        cited={cited.map((m) => ({ id: m.id, retracted: m.status !== "active", content: m.status === "active" ? m.content : "", occurredAt: m.occurredAt.toISOString(), entryId: m.entryId, photoPath: m.entry?.photoPath ?? null, title: m.entry?.title ?? null }))}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/mail" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
      <ArrowLeft size={14} /> 邮件
    </Link>
  );
}

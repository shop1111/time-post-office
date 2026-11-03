import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db, parseJson } from "@/lib/db";
import { letterSources } from "@/lib/letters/sources";
import { LetterView } from "@/components/LetterView";

// 批次 4 之前生成的信会在 reason 末尾拼上核查结果，和现在如实记录的核查徽章冲突，展示时去掉
const LEGACY_CHECK_SUFFIX = /。（(?:引用校验通过|事实核查通过|事实核查未完成|已修正 \d+ 处无依据表述)）$/;

export default async function LetterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const l = await db.letter.findUnique({ where: { id } });
  if (!l || !l.deliveredAt) notFound();
  const ids = parseJson<string[]>(l.citedMemoryIds, []);
  const [cited, sources] = await Promise.all([
    db.memory.findMany({ where: { id: { in: ids } }, include: { entry: { select: { photoPath: true, title: true } } } }),
    letterSources(id),
  ]);

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
          reason: l.reason.replace(LEGACY_CHECK_SUFFIX, ""),
          triggerType: l.triggerType,
          writtenAt: l.writtenAt.toISOString(),
          deliveredAt: l.deliveredAt.toISOString(),
          readAt: l.readAt?.toISOString() ?? null,
          reply: l.reply,
          repliedAt: l.repliedAt?.toISOString() ?? null,
          checkStatus: sources?.checkStatus ?? "unchecked",
          checkNote: sources?.checkNote ?? "",
        }}
        cited={cited.map((m) => ({ id: m.id, content: m.content, occurredAt: m.occurredAt.toISOString(), entryId: m.entryId, photoPath: m.entry?.photoPath ?? null, title: m.entry?.title ?? null }))}
        sentences={sources?.sentences ?? [{ text: l.body, sources: [] }]}
      />
    </div>
  );
}

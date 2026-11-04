import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, PenLine } from "lucide-react";
import { db } from "@/lib/db";
import { cn, fmtCN } from "@/lib/utils";
import { CORRESPONDENT_KIND_LABEL, type CorrespondentKind } from "@/lib/types";

/** 和某位收件人的往来信件 */
export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await db.correspondent.findUnique({ where: { id }, include: { letters: { orderBy: { writtenAt: "asc" } } } });
  if (!c) notFound();
  const visible = c.letters.filter((l) => l.sender === "user" || l.deliveredAt);
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link href="/mail?tab=people" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft size={14} /> 收件人
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-ink-3">{CORRESPONDENT_KIND_LABEL[c.kind as CorrespondentKind]}</div>
          <h1 className="font-hand text-3xl">和{c.kind === "future_self" ? "未来的自己" : c.name}的信</h1>
          {c.moment && (
            <p className="mt-1 max-w-xl text-sm text-ink-2">
              {c.momentAt ? `${fmtCN(c.momentAt)} · ` : ""}
              {c.moment}
            </p>
          )}
        </div>
        <Link href={`/mail/write?to=${c.id}`} className="btn btn-primary">
          <PenLine size={15} /> 写信
        </Link>
      </header>
      {visible.length === 0 && <p className="text-sm text-ink-3">还没有往来信件。</p>}
      <ol className="space-y-3">
        {visible.map((l) => {
          const mine = l.sender === "user";
          const sealed = !l.deliveredAt;
          return (
            <li key={l.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <Link href={`/mail/${l.id}`} className={cn("card block w-[88%] p-4 transition hover:-translate-y-0.5", mine && "bg-stamp-soft/40")}>
                <div className="flex items-center gap-1 text-[11px] text-ink-3">
                  {sealed && <Lock size={11} className="text-gold" />}
                  {mine ? "你" : c.name} · {fmtCN(l.writtenAt)}
                  {sealed && ` · 将于 ${fmtCN(l.scheduledAt)} 送达`}
                </div>
                <div className="mt-1 font-hand text-lg">{l.subject}</div>
                {!sealed && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-ink-2">{l.body}</p>}
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

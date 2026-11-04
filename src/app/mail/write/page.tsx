import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { ensureSystemCorrespondents } from "@/lib/correspondents";
import { LetterComposer } from "@/components/LetterComposer";

const ORDER: Record<string, number> = { person: 0, parallel_self: 1, future_self: 2, curator: 3 };

export default async function WritePage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  const { to } = await searchParams;
  const t = await now();
  await ensureSystemCorrespondents();
  const list = await db.correspondent.findMany({ orderBy: { createdAt: "asc" } });
  const recipients = [...list].sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9)).map((c) => ({ id: c.id, kind: c.kind, name: c.name }));
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link href="/mail" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft size={14} /> 邮件
      </Link>
      <h1 className="font-hand text-3xl">写一封信</h1>
      <LetterComposer today={t.toISOString()} recipients={recipients} initialTo={to} />
    </div>
  );
}

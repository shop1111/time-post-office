import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { db, parseJson } from "@/lib/db";
import { RecapView } from "@/components/recap/RecapView";
import type { RecapPayload } from "@/lib/story";

function shift(month: string, d: number) {
  const [y, m] = month.split("-").map(Number);
  const x = new Date(y, m - 1 + d, 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
}

export default async function RecapPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const cached = await db.monthlyRecap.findUnique({ where: { month } });
  const recap = cached ? parseJson<RecapPayload | null>(cached.payload, null) : null;
  const [y, m] = month.split("-").map(Number);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <Link href="/timeline" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
          <ArrowLeft size={14} /> 时间线
        </Link>
        <div className="flex items-center gap-1 text-sm">
          <Link href={`/recap/${shift(month, -1)}`} className="rounded-full p-1.5 hover:bg-card" aria-label="上个月">
            <ChevronLeft size={16} />
          </Link>
          <span className="font-hand text-lg">
            {y}年{m}月
          </span>
          <Link href={`/recap/${shift(month, 1)}`} className="rounded-full p-1.5 hover:bg-card" aria-label="下个月">
            <ChevronRight size={16} />
          </Link>
        </div>
      </div>
      <RecapView month={month} initial={recap} />
    </div>
  );
}

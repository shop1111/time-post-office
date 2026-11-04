import { userPage } from "@/lib/auth";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { RecapView } from "@/components/recap/RecapView";
import { getCachedRecap } from "@/lib/story";

function shift(month: string, d: number) {
  const [y, m] = month.split("-").map(Number);
  const x = new Date(y, m - 1 + d, 1);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
}

async function RecapPage({ params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  const recap = await getCachedRecap(month);
  const [y, m] = month.split("-").map(Number);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between">
        <Link href="/capsules" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
          <ArrowLeft size={14} /> 胶囊
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

export default userPage(RecapPage);

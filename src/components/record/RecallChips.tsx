"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Link2 } from "lucide-react";
import { ScoreBreakdown, type ScoreParts } from "@/components/memory/ScoreBreakdown";
import type { RankWeights } from "@/lib/memory/rank";
import { cn, fmtCN } from "@/lib/utils";

export interface Recalled {
  id: string;
  content: string;
  date: string;
  score: number;
  entryId: string | null;
  parts: ScoreParts;
}

/** 追问时「想起了…」：点开看这条旧记忆为什么被想起 */
export function RecallChips({ items, weights }: { items: Recalled[]; weights?: RankWeights }) {
  const [open, setOpen] = useState<string | null>(null);
  const cur = items.find((r) => r.id === open);

  return (
    <div className="mb-1.5">
      <div className="flex flex-wrap gap-1.5">
        {items.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setOpen((o) => (o === r.id ? null : r.id))}
            aria-expanded={open === r.id}
            className={cn("chip !bg-post-soft !text-post transition hover:brightness-95", open === r.id && "!border-post")}
          >
            <Link2 size={11} /> 想起了 {fmtCN(r.date, false)}：{r.content.length > 16 ? `${r.content.slice(0, 16)}…` : r.content}
            <ChevronDown size={11} className={cn("transition", open === r.id && "rotate-180")} />
          </button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {cur && (
          <motion.div key={cur.id} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mt-2 rounded-xl border border-line bg-card p-3">
              <div className="flex items-baseline justify-between gap-2 text-[11px] text-ink-3">
                <span>{fmtCN(cur.date)} 的记忆</span>
                <Link href={cur.entryId ? `/entry/${cur.entryId}` : "/memory"} target="_blank" className="hover:text-ink hover:underline">
                  看原记录 →
                </Link>
              </div>
              <p className="mt-1 text-sm leading-6">{cur.content}</p>
              <ScoreBreakdown className="mt-3" parts={cur.parts} score={cur.score} weights={weights} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

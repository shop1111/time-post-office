"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { Postmark, Stamp, senderText } from "./Postal";
import type { EnvelopeData } from "./Envelope";
import { fmtCN } from "@/lib/utils";

/** 首页主角：最新一封未拆的信，放大成一只完整的信封 */
export function HeroEnvelope({ l, more = 0 }: { l: EnvelopeData; more?: number }) {
  return (
    <motion.div className="h-full" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
      <Link href={`/mail/${l.id}`} className="group block h-full" aria-label={`拆开来信：${l.subject}`}>
        <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-[var(--shadow)] ring-2 ring-stamp/30 transition duration-300 group-hover:-translate-y-1">
          <div className="airmail h-2 w-full" />
          {/* 信封盖：悬停时微微掀起 */}
          <svg
            viewBox="0 0 400 60"
            preserveAspectRatio="none"
            className="absolute inset-x-0 top-2 h-8 w-full origin-top transition duration-500 group-hover:[transform:rotateX(40deg)] sm:h-12"
          >
            <path d="M0 0 L200 56 L400 0" fill="var(--paper-2)" stroke="var(--line)" strokeWidth="1.5" />
          </svg>

          <div className="relative flex flex-1 flex-col gap-5 p-5 pt-12 sm:flex-row sm:items-end sm:gap-6 sm:p-6 sm:pt-14">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-xs tracking-wider text-stamp">
                <span className="h-2 w-2 animate-pulse rounded-full bg-stamp" />
                {more > 0 ? `新来信 · 还有 ${more} 封在后面` : "一封新来信"}
              </div>
              <div className="mt-3 text-sm text-ink-3">{senderText(l, l.writtenAt)}</div>
              <div className="mt-1 line-clamp-2 font-hand text-2xl leading-snug sm:text-3xl">{l.subject}</div>
              <div className="mt-2 text-xs text-ink-3">{l.deliveredAt ? `${fmtCN(l.deliveredAt, false)}送达` : ""}</div>
            </div>

            <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end sm:justify-end">
              <Stamp party={l} className="rotate-3" />
              <span className="btn btn-primary">
                拆开这封信 <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
              </span>
            </div>
          </div>

          {l.deliveredAt && (
            <Postmark date={l.deliveredAt} className="pointer-events-none absolute right-16 top-6 hidden h-16 w-16 sm:block" />
          )}
        </div>
      </Link>
    </motion.div>
  );
}

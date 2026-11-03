"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Stamp, SENDER_TEXT } from "./Postal";
import { cn, fmtCN } from "@/lib/utils";

export interface EnvelopeData {
  id: string;
  sender: string;
  subject: string;
  deliveredAt: string | null;
  scheduledAt: string;
  readAt: string | null;
  writtenAt: string;
}

export function Envelope({ l, index = 0 }: { l: EnvelopeData; index?: number }) {
  const unread = !l.readAt && !!l.deliveredAt;
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06 }}>
      <Link href={`/mailbox/${l.id}`} className="group block">
        <div
          className={cn(
            "relative overflow-hidden rounded-xl border border-line bg-card shadow-[var(--shadow)] transition duration-300 group-hover:-translate-y-1 group-hover:rotate-[-0.6deg]",
            unread && "ring-2 ring-stamp/40",
          )}
        >
          <div className="airmail h-1.5 w-full" />
          {/* 信封盖 */}
          <svg viewBox="0 0 400 60" preserveAspectRatio="none" className="absolute inset-x-0 top-1.5 h-5 w-full origin-top transition duration-500 group-hover:[transform:rotateX(35deg)]">
            <path d="M0 0 L200 54 L400 0" fill="var(--paper-2)" stroke="var(--line)" strokeWidth="1.5" />
          </svg>
          <div className="relative flex items-start gap-3 p-4 pt-6">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] tracking-wider text-ink-3">{SENDER_TEXT[l.sender]}</div>
              <div className="mt-1 truncate font-hand text-lg leading-snug">{l.subject}</div>
              <div className="mt-2 text-[11px] text-ink-3">
                {l.sender === "past_self" || l.sender === "user" ? `寄出于 ${fmtCN(l.writtenAt)} · ` : ""}
                {l.deliveredAt ? `${fmtCN(l.deliveredAt, false)}送达` : `将于 ${fmtCN(l.scheduledAt)} 送达`}
              </div>
            </div>
            <Stamp sender={l.sender} />
          </div>
          {unread && <span className="absolute left-3 top-4 h-2 w-2 animate-pulse rounded-full bg-stamp" />}
        </div>
      </Link>
    </motion.div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronDown, Square, Volume2 } from "lucide-react";
import { Postmark, Stamp, SENDER_TEXT } from "./Postal";
import { TRIGGER_LABEL } from "./postman/labels";
import { EnvelopeOpening } from "./letter/EnvelopeOpening";
import { LetterBody } from "./letter/LetterBody";
import { CheckBadge } from "./letter/CheckBadge";
import { ReplyBox } from "./letter/ReplyBox";
import { useReadAloud } from "./letter/useReadAloud";
import { fmtCN, photoUrl, daysBetween } from "@/lib/utils";
import type { CheckStatus, LetterSentenceSources } from "@/lib/types";

interface L {
  id: string;
  sender: string;
  subject: string;
  body: string;
  reason: string;
  triggerType: string;
  writtenAt: string;
  deliveredAt: string;
  readAt: string | null;
  reply: string | null;
  repliedAt: string | null;
  checkStatus: CheckStatus;
  checkNote: string;
}
interface Cited {
  id: string;
  content: string;
  occurredAt: string;
  entryId: string | null;
  photoPath: string | null;
  title: string | null;
}

export function LetterView({ l, cited, sentences }: { l: L; cited: Cited[]; sentences: LetterSentenceSources[] }) {
  // 只看进页面那一刻是否读过：标记已读后页面会刷新，不能因此跳过拆信
  const [firstRead] = useState(!l.readAt);
  const [opened, setOpened] = useState(!firstRead);
  const [reveal, setReveal] = useState(false);
  const [why, setWhy] = useState(false);
  const router = useRouter();
  const gap = daysBetween(l.writtenAt, l.deliveredAt);
  const texts = useMemo(() => sentences.map((s) => s.text), [sentences]);
  const voice = useReadAloud(texts);

  useEffect(() => {
    if (!l.readAt) fetch(`/api/letters/${l.id}`, { method: "POST", body: JSON.stringify({ action: "read" }) }).then(() => router.refresh());
  }, [l.id, l.readAt, router]);

  const onOpened = useCallback((skipped: boolean) => {
    setReveal(!skipped);
    setOpened(true);
  }, []);

  if (!opened) return <EnvelopeOpening sender={l.sender} subject={l.subject} onOpened={onOpened} />;

  return (
    <motion.article initial={firstRead ? { opacity: 0, y: 40 } : false} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", damping: 20 }} className="mt-4">
      <div className="relative rounded-2xl border border-line bg-card shadow-[var(--shadow)]">
        <div className="airmail h-1.5 rounded-t-2xl" />
        <div className="flex items-start justify-between gap-3 px-6 pt-5">
          <div className="min-w-0">
            <div className="text-xs tracking-wider text-ink-3">{SENDER_TEXT[l.sender]}</div>
            <h1 className="mt-1 font-hand text-2xl md:text-3xl">{l.subject}</h1>
            <div className="mt-1 text-xs text-ink-3">
              {fmtCN(l.writtenAt)} 寄出 · {fmtCN(l.deliveredAt)} 送达{gap > 1 ? ` · 在路上走了 ${gap} 天` : ""}
            </div>
            {l.sender !== "user" && <CheckBadge className="mt-2" status={l.checkStatus} note={l.checkNote} />}
          </div>
          <div className="relative shrink-0">
            <Stamp sender={l.sender} />
            {/* 手机上邮戳会盖住寄出/送达日期，只在宽屏显示 */}
            <Postmark date={l.writtenAt} className="absolute -bottom-10 -left-10 hidden h-20 w-20 sm:block" />
          </div>
        </div>

        {voice.supported && (
          <div className="mt-4 flex justify-end px-6">
            <button onClick={voice.reading >= 0 ? voice.stop : voice.start} className="btn btn-ghost !px-3 !py-1 text-xs" aria-pressed={voice.reading >= 0}>
              {voice.reading >= 0 ? <Square size={12} /> : <Volume2 size={14} />}
              {voice.reading >= 0 ? "停止朗读" : "朗读这封信"}
            </button>
          </div>
        )}
        <LetterBody sentences={sentences} reveal={reveal} reading={voice.reading} />
      </div>

      {/* 可解释性：为什么收到这封信 */}
      <div className="card mt-4 overflow-hidden">
        <button onClick={() => setWhy((w) => !w)} className="flex w-full items-center justify-between px-5 py-3 text-left text-sm">
          <span>
            <span className="mr-2 rounded bg-post-soft px-1.5 py-0.5 text-[11px] text-post">{TRIGGER_LABEL[l.triggerType] ?? l.triggerType}</span>
            为什么会收到这封信？
          </span>
          <ChevronDown size={16} className={why ? "rotate-180 transition" : "transition"} />
        </button>
        {why && (
          <div className="border-t border-line px-5 py-4 text-sm">
            <p className="text-ink-2">{l.reason}</p>
            {cited.length > 0 && (
              <>
                <div className="mt-3 text-xs text-ink-3">这封信引用了这些真实的回忆：</div>
                <div className="mt-2 space-y-2">
                  {cited.map((c) => (
                    <Link key={c.id} href={c.entryId ? `/entry/${c.entryId}` : "/memory"} className="flex items-center gap-3 rounded-xl border border-line p-2 hover:bg-paper-2">
                      {c.photoPath ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photoUrl(c.photoPath)!} alt="" className="h-12 w-12 rounded-lg object-cover" />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-paper-2 text-lg">📝</div>
                      )}
                      <div className="min-w-0">
                        <div className="text-[11px] text-ink-3">{fmtCN(c.occurredAt)}{c.title ? ` · ${c.title}` : ""}</div>
                        <div className="truncate text-sm">{c.content}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {l.sender !== "user" && <ReplyBox letterId={l.id} sender={l.sender} triggerType={l.triggerType} initialReply={l.reply} />}
    </motion.article>
  );
}

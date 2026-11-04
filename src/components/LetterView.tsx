"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronDown, Reply } from "lucide-react";
import { Postmark, Stamp, SENDER_TEXT } from "./Postal";
import { useToast } from "./Toast";
import { fmtCN, photoUrl, daysBetween } from "@/lib/utils";

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
}
interface Cited {
  id: string;
  /** 写信后被用户撤回：不再展示原文 */
  retracted: boolean;
  content: string;
  occurredAt: string;
  entryId: string | null;
  photoPath: string | null;
  title: string | null;
}

const TRIGGER_LABEL: Record<string, string> = {
  anniversary: "周年回顾",
  open_loop: "未完结的线索",
  low_mood: "情绪关怀",
  milestone: "里程碑",
  capsule: "时间胶囊",
  welcome: "初次见面",
  manual: "小局手写",
};

export function LetterView({ l, cited }: { l: L; cited: Cited[] }) {
  const [opened, setOpened] = useState(!!l.readAt);
  const [why, setWhy] = useState(false);
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState(l.reply);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const gap = daysBetween(l.writtenAt, l.deliveredAt);

  useEffect(() => {
    if (!l.readAt) fetch(`/api/letters/${l.id}`, { method: "POST", body: JSON.stringify({ action: "read" }) }).then(() => router.refresh());
  }, [l.id, l.readAt, router]);

  async function sendReply() {
    setBusy(true);
    await fetch(`/api/letters/${l.id}`, { method: "POST", body: JSON.stringify({ action: "reply", reply }) });
    setBusy(false);
    setSent(reply);
    toast("回信已寄出，小局会把它也好好收起来", "✉️");
    router.refresh();
  }

  if (!opened) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center">
        <motion.button
          onClick={() => setOpened(true)}
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          whileHover={{ rotate: -2, scale: 1.02 }}
          className="relative w-full max-w-md overflow-hidden rounded-xl border border-line bg-card shadow-[var(--shadow)]"
        >
          <div className="airmail h-2" />
          <svg viewBox="0 0 400 120" className="w-full">
            <path d="M0 0 L200 100 L400 0" fill="var(--paper-2)" stroke="var(--line)" />
            <circle cx="200" cy="96" r="18" fill="var(--stamp)" />
            <text x="200" y="102" textAnchor="middle" fontSize="16" fill="#fff">
              邮
            </text>
          </svg>
          <div className="flex items-end justify-between p-5 pt-0 text-left">
            <div>
              <div className="text-xs text-ink-3">{SENDER_TEXT[l.sender]}</div>
              <div className="mt-1 font-hand text-2xl">{l.subject}</div>
            </div>
            <Stamp sender={l.sender} />
          </div>
        </motion.button>
        <p className="mt-6 animate-pulse text-sm text-ink-3">轻触火漆，拆开这封信</p>
      </div>
    );
  }

  return (
    <motion.article initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", damping: 20 }} className="mt-4">
      <div className="relative rounded-2xl border border-line bg-card shadow-[var(--shadow)]">
        <div className="airmail h-1.5 rounded-t-2xl" />
        <div className="flex items-start justify-between px-6 pt-5">
          <div>
            <div className="text-xs tracking-wider text-ink-3">{SENDER_TEXT[l.sender]}</div>
            <h1 className="mt-1 font-hand text-2xl md:text-3xl">{l.subject}</h1>
            <div className="mt-1 text-xs text-ink-3">
              {fmtCN(l.writtenAt)} 寄出 · {fmtCN(l.deliveredAt)} 送达{gap > 1 ? ` · 在路上走了 ${gap} 天` : ""}
            </div>
          </div>
          <div className="relative">
            <Stamp sender={l.sender} />
            <Postmark date={l.writtenAt} className="absolute -bottom-10 -left-10 h-20 w-20" />
          </div>
        </div>
        <div className="letter-paper mx-3 mb-3 mt-6 whitespace-pre-wrap rounded-xl px-5 py-[14px] font-hand text-[18px] md:px-8">
          {l.body.split("").map((ch, i) => (
            <motion.span key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i * 0.012, 3) }}>
              {ch}
            </motion.span>
          ))}
        </div>
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
                        <div className="truncate text-sm">{c.retracted ? <span className="text-ink-3">这条回忆已被你撤回</span> : c.content}</div>
                      </div>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 回信 */}
      {l.sender !== "user" && (
        <div className="card mt-4 p-5">
          {sent ? (
            <div>
              <div className="flex items-center gap-2 text-sm text-ink-3">
                <Reply size={14} /> 你的回信
              </div>
              <p className="mt-2 whitespace-pre-wrap font-hand text-lg leading-8">{sent}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm text-ink-2">
                <Reply size={14} /> 给{l.sender === "past_self" ? "过去的自己" : l.sender === "future_self" ? "未来的自己" : "小局"}回一封信
              </div>
              <textarea className="input mt-3 min-h-[110px] font-hand text-lg" placeholder="回信也会成为你的一段记录" value={reply} onChange={(e) => setReply(e.target.value)} />
              <div className="mt-3 flex justify-end">
                <button className="btn btn-primary" disabled={busy || !reply.trim()} onClick={sendReply}>
                  寄出回信
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </motion.article>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ChevronDown, Reply, Hourglass } from "lucide-react";
import { Postmark, Stamp, senderText } from "./Postal";
import { useToast } from "./Toast";
import { fmtCN, photoUrl, daysBetween } from "@/lib/utils";
import type { LetterKnowledge } from "@/lib/types";

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
  /** 旧版回信 */
  reply: string | null;
  kind: string | null;
  name: string | null;
  correspondentId: string | null;
  knowledge: LetterKnowledge | null;
  /** 这是哪封信的回信 */
  inReplyTo: { id: string; subject: string } | null;
  /** 你寄出的信：代笔回信的状态 */
  replyState: { pending: boolean; letterId: string | null } | null;
  /** 你对这封信的回复 */
  myReplies: Array<{ id: string; subject: string; body: string; writtenAt: string }>;
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
  anniversary: "回顾往事",
  open_loop: "惦记的事",
  low_mood: "情绪关怀",
  milestone: "里程碑",
  greeting: "随手问候",
  reply: "代笔回信",
  future_letter: "写给未来的信",
  capsule: "写给未来的信",
  letter: "你寄出的信",
  welcome: "初次见面",
  manual: "小局手写",
};

export function LetterView({ l, cited }: { l: L; cited: Cited[] }) {
  const mine = l.sender === "user";
  const toFuture = mine && l.kind === "future_self";
  const canReply = !mine;
  const [opened, setOpened] = useState(!!l.readAt);
  const [why, setWhy] = useState(false);
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const gap = daysBetween(l.writtenAt, l.deliveredAt);
  const replyTo = l.sender === "curator" || l.sender === "postman" ? "小局" : l.name ?? "TA";

  useEffect(() => {
    if (!l.readAt) fetch(`/api/letters/${l.id}`, { method: "POST", body: JSON.stringify({ action: "read" }) }).then(() => router.refresh());
  }, [l.id, l.readAt, router]);

  async function sendReply() {
    setBusy(true);
    const r = await fetch(`/api/letters/${l.id}`, { method: "POST", body: JSON.stringify({ action: "reply", reply }) });
    setBusy(false);
    if (!r.ok) return toast((await r.json()).error ?? "寄送失败", "⚠️");
    setSent(true);
    setReply("");
    toast(`回信已寄出，${replyTo}会在一天之内回复你`, "✉️");
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
              <div className="text-xs text-ink-3">{senderText(l, l.writtenAt)}</div>
              <div className="mt-1 font-hand text-2xl">{l.subject}</div>
            </div>
            <Stamp party={l} />
          </div>
        </motion.button>
        <p className="mt-6 animate-pulse text-sm text-ink-3">轻触火漆，拆开这封信</p>
      </div>
    );
  }

  const k = l.knowledge;
  return (
    <motion.article initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", damping: 20 }} className="mt-4">
      <div className="relative rounded-2xl border border-line bg-card shadow-[var(--shadow)]">
        <div className="airmail h-1.5 rounded-t-2xl" />
        <div className="flex items-start justify-between px-6 pt-5">
          <div>
            <div className="text-xs tracking-wider text-ink-3">{senderText(l, l.writtenAt)}</div>
            <h1 className="mt-1 font-hand text-2xl md:text-3xl">{l.subject}</h1>
            <div className="mt-1 text-xs text-ink-3">
              {mine && !toFuture
                ? `${fmtCN(l.writtenAt)} 寄出`
                : `${fmtCN(l.writtenAt)} 写 · ${fmtCN(l.deliveredAt)} 送达${gap > 1 ? ` · 在路上走了 ${gap} 天` : ""}`}
            </div>
            {l.inReplyTo && (
              <Link href={`/mail/${l.inReplyTo.id}`} className="mt-1 inline-block text-xs text-ink-3 underline-offset-4 hover:underline">
                回复《{l.inReplyTo.subject}》
              </Link>
            )}
          </div>
          <div className="relative">
            <Stamp party={l} />
            <Postmark date={l.writtenAt} className="absolute -bottom-10 -left-10 h-20 w-20" />
          </div>
        </div>
        <div className="letter-paper mx-3 mb-3 mt-6 whitespace-pre-wrap rounded-xl px-5 py-[14px] font-hand text-[18px] md:px-8">
          {l.body.split("").map((ch, i) => (
            <motion.span key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: mine ? 0 : Math.min(i * 0.012, 3) }}>
              {ch}
            </motion.span>
          ))}
        </div>
      </div>

      {/* 你寄出的信：回信状态 */}
      {mine && !toFuture && l.replyState && (
        <div className="card mt-4 flex items-center gap-2 p-4 text-sm text-ink-2">
          <Hourglass size={14} className="text-gold" />
          {l.replyState.letterId && !l.replyState.pending ? (
            <Link href={`/mail/${l.replyState.letterId}`} className="text-stamp underline-offset-4 hover:underline">
              {l.name}已经回信了，去看看 →
            </Link>
          ) : (
            <span>{l.name}收到了，会在一天之内回信。</span>
          )}
        </div>
      )}

      {/* 可解释性：为什么收到这封信 */}
      {!mine && (
        <div className="card mt-4 overflow-hidden">
          <button onClick={() => setWhy((w) => !w)} className="flex w-full items-center justify-between px-5 py-3 text-left text-sm">
            <span>
              <span className="mr-2 rounded bg-post-soft px-1.5 py-0.5 text-[11px] text-post">{TRIGGER_LABEL[l.triggerType] ?? l.triggerType}</span>
              为什么会收到这封信？
            </span>
            <ChevronDown size={16} className={why ? "rotate-180 transition" : "transition"} />
          </button>
          {why && (
            <div className="space-y-3 border-t border-line px-5 py-4 text-sm">
              <p className="text-ink-2">{l.reason}</p>
              {l.sender === "persona" && l.kind === "person" && k && (
                <>
                  <KnowledgeList title={`${l.name}知道的事`} items={k.known} empty={`除了你们之间的信，${l.name}不知道你的其他事。`} />
                  <KnowledgeList title={`小局判断${l.name}不知道、所以没写进去的事`} items={k.unknown} muted />
                </>
              )}
              {l.sender === "persona" && l.kind === "parallel_self" && k?.before && (
                <p className="text-xs text-ink-3">平行时空的你只记得 {fmtCN(k.before)} 分岔之前的事，之后的生活是另一种可能，是想象出来的。</p>
              )}
              {cited.length > 0 && (
                <>
                  <div className="text-xs text-ink-3">这封信引用了这些真实的回忆：</div>
                  <div className="space-y-2">
                    {cited.map((c) => (
                      <Link key={c.id} href={c.entryId ? `/capsules/${c.entryId}` : "/memory"} className="flex items-center gap-3 rounded-xl border border-line p-2 hover:bg-paper-2">
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
      )}

      {/* 回信 */}
      {canReply && (
        <div className="card mt-4 p-5">
          {l.reply && (
            <div className="mb-4">
              <div className="flex items-center gap-2 text-sm text-ink-3">
                <Reply size={14} /> 你的回信
              </div>
              <p className="mt-2 whitespace-pre-wrap font-hand text-lg leading-8">{l.reply}</p>
            </div>
          )}
          {l.myReplies.map((r) => (
            <Link key={r.id} href={`/mail/${r.id}`} className="mb-4 block">
              <div className="flex items-center gap-2 text-sm text-ink-3">
                <Reply size={14} /> 你在 {fmtCN(r.writtenAt)} 回了信
              </div>
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap font-hand text-lg leading-8">{r.body}</p>
            </Link>
          ))}
          {sent ? (
            <p className="text-sm text-ink-2">回信已寄出，{replyTo}会在一天之内回复你。</p>
          ) : (
            <>
              <div className="flex items-center gap-2 text-sm text-ink-2">
                <Reply size={14} /> 给{replyTo}回一封信
              </div>
              <textarea className="input mt-3 min-h-[110px] font-hand text-lg" placeholder="回信也会被小局记住" value={reply} onChange={(e) => setReply(e.target.value)} />
              <div className="mt-3 flex justify-end">
                <button className="btn btn-primary" disabled={busy || !reply.trim()} onClick={sendReply}>
                  寄出回信
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {l.correspondentId && l.kind !== "curator" && (
        <Link href={`/mail/to/${l.correspondentId}`} className="mt-4 inline-block text-sm text-ink-3 underline-offset-4 hover:underline">
          查看和{l.kind === "future_self" ? "未来的自己" : l.name}的全部往来信件 →
        </Link>
      )}
    </motion.article>
  );
}

function KnowledgeList({ title, items, empty, muted }: { title: string; items: LetterKnowledge["known"]; empty?: string; muted?: boolean }) {
  if (!items.length && !empty) return null;
  return (
    <div>
      <div className="text-xs text-ink-3">{title}</div>
      {items.length ? (
        <ul className="mt-1.5 space-y-1.5">
          {items.map((i) => (
            <li key={i.id} className={`rounded-lg border border-line px-3 py-2 ${muted ? "text-ink-3" : ""}`}>
              <div className="text-sm">{i.content}</div>
              <div className="mt-0.5 text-[11px] text-ink-3">{i.why}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-ink-3">{empty}</p>
      )}
    </div>
  );
}

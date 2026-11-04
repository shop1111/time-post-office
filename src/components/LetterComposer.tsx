"use client";

import { DateInput } from "@/components/DateInput";
import { XiaojuImage } from "@/components/XiaojuImage";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Plus } from "lucide-react";
import { useToast } from "./Toast";
import { CorrespondentForm } from "./mail/CorrespondentForm";
import { cn } from "@/lib/utils";

const PRESETS = [
  { label: "一个月后", days: 30 },
  { label: "半年后", days: 182 },
  { label: "一年后", days: 365 },
  { label: "三年后", days: 1095 },
];

export interface Recipient {
  id: string;
  kind: string;
  name: string;
}

const toDateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const cnDate = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;

/** 默认展开写给未来自己的信，也支持通过链接指定收件人。 */
export function LetterComposer({ today, recipients, initialTo }: { today: string; recipients: Recipient[]; initialTo?: string }) {
  const [to, setTo] = useState(() =>
    recipients.find((r) => r.id === initialTo)?.id
    ?? recipients.find((r) => r.kind === "future_self")?.id
    ?? recipients[0]?.id
    ?? "",
  );
  const [adding, setAdding] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [days, setDays] = useState(182);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const now = new Date(today);
  const target = recipients.find((r) => r.id === to);
  const future = target?.kind === "future_self";
  const tomorrow = new Date(now.getTime() + 86_400_000);
  const when = custom ? new Date(`${custom}T09:00:00`) : new Date(now.getTime() + days * 86_400_000);
  const who = target ? (target.kind === "parallel_self" ? "平行时空的你" : target.name) : "";

  async function send() {
    setBusy(true);
    const r = await fetch("/api/letters", {
      method: "POST",
      body: JSON.stringify({ correspondentId: to, subject, body, deliverAt: future ? when.toISOString() : undefined }),
    });
    const data = await r.json();
    setBusy(false);
    if (!r.ok) return toast(data.error ?? "寄送失败", "⚠️");
    setSent(true);
    toast(future ? `信已封好，将于 ${cnDate(when)} 送达` : `信已寄出，${who}会在一天之内回信`, "💌");
    setTimeout(() => router.push(`/mail/${data.letter.id}`), 1400);
  }

  return (
    <div className="relative space-y-4">
      <AnimatePresence>
        {sent && (
          <motion.div
            initial={{ opacity: 1, y: 0, scale: 1 }}
            animate={{ opacity: 0, y: -160, scale: 0.4, rotate: -12 }}
            transition={{ duration: 1.4, ease: "easeIn" }}
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center text-7xl"
          >
            💌
          </motion.div>
        )}
      </AnimatePresence>

      <div>
        <div className="mb-2 text-sm text-ink-2">写给谁</div>
        <div className="flex flex-wrap gap-2">
          {recipients.map((r) => (
            <button
              key={r.id}
              onClick={() => {
                setTo(r.id);
                setAdding(false);
              }}
              aria-pressed={!adding && to === r.id}
              className={cn("chip !py-1.5", !adding && to === r.id && "!border-stamp !bg-stamp-soft !text-stamp")}
            >
              {r.kind === "curator" ? "📮" : r.kind === "future_self" ? "💌" : r.kind === "parallel_self" ? "🪐" : "✉️"} {r.name}
            </button>
          ))}
          <button onClick={() => setAdding((a) => !a)} aria-expanded={adding} className={cn("chip !py-1.5", adding && "!border-stamp !bg-stamp-soft !text-stamp")}>
            <Plus size={13} /> 新收件人
          </button>
        </div>
        {adding && (
          <div className="mt-3">
            <CorrespondentForm
              today={today}
              onCreated={(id) => {
                setAdding(false);
                setTo(id);
                router.refresh();
              }}
            />
          </div>
        )}
      </div>

      {!adding && target && (
        <div className={cn("card overflow-hidden transition", sent && "opacity-30")}>
          <div className="airmail h-1.5" />
          <div className="p-5">
            {target.kind === "curator" && (
              <div className="mb-4 flex items-center gap-3 rounded-xl border border-line bg-paper px-3 pt-2">
                <XiaojuImage scene="compose" className="h-16 w-16" />
                <p className="font-hand text-lg text-ink-2">写给小局</p>
              </div>
            )}
            <input
              aria-label="信的标题"
              className="w-full bg-transparent font-hand text-xl outline-none placeholder:text-ink-3"
              placeholder={future ? "信的标题，例如：给一年后的自己" : `信的标题，例如：写给${who}`}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
            <textarea
              aria-label="信的正文"
              className="letter-paper mt-3 min-h-[216px] w-full resize-y rounded-lg px-3 font-hand text-lg outline-none"
              placeholder={
                future
                  ? "写下现在的心情、正在烦恼的事、想对未来的自己说的话……"
                  : target.kind === "parallel_self"
                    ? "问问那个做了另一个选择的你：你现在在干什么？当时如果……会怎么样？"
                    : target.kind === "curator"
                      ? "想对小局说点什么？"
                      : `想对${target.name}说的话……`
              }
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {future ? (
                <>
                  <span className="text-sm text-ink-2">送达时间：</span>
                  {PRESETS.map((p) => (
                    <button
                      key={p.days}
                      onClick={() => {
                        setDays(p.days);
                        setCustom("");
                      }}
                      className={cn("chip !py-1", !custom && days === p.days && "!border-stamp !bg-stamp-soft !text-stamp")}
                    >
                      {p.label}
                    </button>
                  ))}
                  <DateInput className="w-48 text-sm [&_.input]:py-1" min={toDateInput(tomorrow)} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="自定义送达日期" />
                  <span className="text-xs text-ink-3">（{cnDate(when)} 送达）</span>
                </>
              ) : (
                <span className="text-xs text-ink-3">{target.kind === "curator" ? "小局会在一天之内回信。" : `${who}会在一天之内回信（由 agent 以 TA 的身份代笔）。`}</span>
              )}
              <button className="btn btn-primary ml-auto" disabled={busy || !body.trim()} onClick={send}>
                {future ? "封存并寄出" : "寄出"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

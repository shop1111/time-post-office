"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "./Toast";
import { cn } from "@/lib/utils";

const PRESETS = [
  { label: "一个月后", days: 30 },
  { label: "半年后", days: 182 },
  { label: "一年后", days: 365 },
  { label: "三年后", days: 1095 },
];

export function CapsuleComposer({ today }: { today: string }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [days, setDays] = useState(182);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const when = new Date(new Date(today).getTime() + days * 86_400_000);

  async function send() {
    setBusy(true);
    const r = await fetch("/api/letters", { method: "POST", body: JSON.stringify({ subject, body, deliverAt: when.toISOString() }) });
    setBusy(false);
    if (!r.ok) return toast((await r.json()).error ?? "寄送失败", "⚠️");
    setSent(true);
    setTimeout(() => {
      setSent(false);
      setBody("");
      setSubject("");
      router.refresh();
    }, 1600);
    toast(`时间胶囊已封存，将于 ${when.getFullYear()}年${when.getMonth() + 1}月${when.getDate()}日 送达`, "💌");
  }

  return (
    <div className="relative">
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
      <div className={cn("card overflow-hidden transition", sent && "opacity-30")}>
        <div className="airmail h-1.5" />
        <div className="p-5">
          <input className="w-full bg-transparent font-hand text-xl outline-none placeholder:text-ink-3" placeholder="信的标题，例如：给半年后的自己" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea
            className="letter-paper mt-3 min-h-[216px] w-full resize-y rounded-lg px-3 font-hand text-lg outline-none"
            placeholder="写下现在的心情、正在烦恼的事、想对未来的自己说的话……"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-sm text-ink-2">送达时间：</span>
            {PRESETS.map((p) => (
              <button key={p.days} onClick={() => setDays(p.days)} className={cn("chip !py-1", days === p.days && "!border-stamp !bg-stamp-soft !text-stamp")}>
                {p.label}
              </button>
            ))}
            <span className="text-xs text-ink-3">
              （{when.getFullYear()}年{when.getMonth() + 1}月{when.getDate()}日）
            </span>
            <button className="btn btn-primary ml-auto" disabled={busy || !body.trim()} onClick={send}>
              封存并寄出
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

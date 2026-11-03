"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { FastForward, RotateCcw } from "lucide-react";
import { useToast } from "./Toast";
import { cn } from "@/lib/utils";

interface Candidate {
  key: string;
  type: string;
  sender: string;
  priority: number;
  reason: string;
}

/**
 * 时光机：虚拟时钟快进，让「几个月后的来信」可以当场演示。
 */
export function TimeMachine({ today, offsetDays }: { today: string; offsetDays: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [log, setLog] = useState<Candidate[] | null>(null);
  const router = useRouter();
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const d = new Date(today);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function forward(days: number) {
    setBusy(days);
    try {
      const r = await fetch("/api/postman", { method: "POST", body: JSON.stringify({ action: "forward", days }) }).then((r) => r.json());
      const n = r.generated.length + r.delivered.length;
      setLog(r.candidates);
      toast(n ? `时光流过 ${days} 天，邮差送来了 ${n} 封信` : `时光流过 ${days} 天，暂时没有新的信`, n ? "📮" : "⏳");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    await fetch("/api/postman", { method: "POST", body: JSON.stringify({ action: "reset" }) });
    setLog(null);
    toast("已回到真实的今天", "🕰️");
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn("flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition", offsetDays ? "border-gold bg-gold/15 text-ink" : "border-line bg-card text-ink-2")}
      >
        <span className="font-hand text-sm">{d.getMonth() + 1}月{d.getDate()}日</span>
        {offsetDays > 0 && <span className="text-[10px] text-gold">+{offsetDays}天</span>}
        <FastForward size={13} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            className="card absolute right-0 top-10 z-50 w-[min(88vw,340px)] p-4"
          >
            <div className="font-hand text-lg">时光机</div>
            <p className="mt-1 text-xs leading-relaxed text-ink-2">
              快进虚拟时间，邮差引擎会立刻巡检：周年回顾、到期的计划、情绪关怀、时间胶囊……都会在「未来」送达。
            </p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[1, 7, 30, 90].map((n) => (
                <button key={n} disabled={busy !== null} onClick={() => forward(n)} className="btn btn-ghost !px-2 !py-2 text-xs">
                  {busy === n ? "…" : `+${n}天`}
                </button>
              ))}
            </div>
            {offsetDays > 0 && (
              <button onClick={reset} className="mt-2 flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
                <RotateCcw size={12} /> 回到真实的今天（已快进 {offsetDays} 天）
              </button>
            )}
            {log && (
              <div className="mt-3 border-t border-line pt-3">
                <div className="mb-1 text-[11px] font-medium text-ink-3">邮差引擎 · 本次候选（按优先级）</div>
                <ul className="max-h-48 space-y-1 overflow-auto text-[11px] text-ink-2">
                  {log.length === 0 && <li>没有满足条件的触发器</li>}
                  {log.map((c) => (
                    <li key={c.key} className="flex gap-2">
                      <span className="shrink-0 font-mono text-gold">{c.priority.toFixed(1)}</span>
                      <span className="shrink-0 rounded bg-paper-2 px-1">{c.type}</span>
                      <span className="line-clamp-2">{c.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

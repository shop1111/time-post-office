"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { FastForward, RotateCcw } from "lucide-react";
import { useToast } from "./Toast";
import { TimeTravelOverlay } from "./postman/TimeTravelOverlay";
import type { PostmanRequestBody } from "./postman/usePostmanRun";
import { cn } from "@/lib/utils";

/**
 * 时光机：虚拟时钟快进，让「几个月后的来信」可以当场演示。
 * 快进时全屏过场，直播邮差引擎的每一个决定。
 */
export function TimeMachine({ today, offsetDays }: { today: string; offsetDays: number }) {
  const [open, setOpen] = useState(false);
  const [run, setRun] = useState<PostmanRequestBody | null>(null);
  const router = useRouter();
  const toast = useToast();
  const ref = useRef<HTMLDivElement>(null);
  const d = new Date(today);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function forward(days: number) {
    setOpen(false);
    setRun({ action: "forward", days });
  }

  const finish = useCallback(() => {
    setRun(null);
    router.refresh();
  }, [router]);

  async function reset() {
    try {
      const r = await fetch("/api/postman", { method: "POST", body: JSON.stringify({ action: "reset" }) });
      if (!r.ok) throw new Error();
      toast("已回到真实的今天", "🕰️");
      router.refresh();
    } catch {
      // 失败时时钟还停在快进后的日子，如实说，按钮还在可以再点
      toast("没能拨回今天，请稍后再试", "⚠️");
    }
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
              快进虚拟时间，邮差引擎会立刻巡检：周年回顾、到期的计划、情绪关怀、时间胶囊……你会看到它对每个候选做了什么决定。
            </p>
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[1, 7, 30, 90].map((n) => (
                <button key={n} disabled={run !== null} onClick={() => forward(n)} className="btn btn-ghost !px-2 !py-2 text-xs">
                  +{n}天
                </button>
              ))}
            </div>
            {offsetDays > 0 && (
              <button onClick={reset} className="mt-2 flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
                <RotateCcw size={12} /> 回到真实的今天（已快进 {offsetDays} 天）
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {run && <TimeTravelOverlay request={run} onClose={finish} />}
    </div>
  );
}

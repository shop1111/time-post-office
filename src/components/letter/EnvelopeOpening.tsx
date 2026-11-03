"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Stamp, SENDER_TEXT } from "@/components/Postal";

/**
 * 拆信仪式：火漆裂开 → 信封盖翻起 → 信纸抽出，然后交给正文逐字浮现。
 * 随时可以跳过；系统开了「减少动态效果」时直接打开。
 */
export function EnvelopeOpening({ sender, subject, onOpened }: { sender: string; subject: string; onOpened: (skipped: boolean) => void }) {
  const reduced = useReducedMotion() ?? false;
  const [opening, setOpening] = useState(false);

  // 信纸抽出、正面淡出之后进入正文
  useEffect(() => {
    if (!opening) return;
    const timer = setTimeout(() => onOpened(false), 1900);
    return () => clearTimeout(timer);
  }, [opening, onOpened]);

  function open() {
    if (opening) return onOpened(true);
    if (reduced) return onOpened(true);
    setOpening(true);
  }

  const t = (delay: number, duration: number) => ({ delay, duration, ease: [0.4, 0, 0.2, 1] as const });

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-2">
      <div className="relative w-full max-w-md" style={{ perspective: 1000 }}>
        <button
          type="button"
          onClick={open}
          aria-label={opening ? "跳过拆信动画" : `拆开${SENDER_TEXT[sender] ?? ""}的信：${subject}`}
          className="relative block aspect-[3/2] w-full rounded-xl sm:aspect-[8/5] text-left outline-none focus-visible:ring-2 focus-visible:ring-stamp"
        >
          {/* 信封背面 */}
          <div className="absolute inset-0 rounded-xl border border-line bg-paper-2 shadow-[var(--shadow)]" />

          {/* 信纸：从信封里抽出来 */}
          <motion.div
            className="letter-paper absolute inset-x-[6%] top-[8%] bottom-[6%] rounded-lg border border-line shadow-sm"
            initial={false}
            animate={opening ? { y: "-58%" } : { y: 0 }}
            transition={t(0.85, 0.75)}
          >
            <div className="px-4 pt-3 font-hand text-sm text-ink-3">{subject}</div>
          </motion.div>

          {/* 信封正面：下半部的 V 形口袋 */}
          <motion.div
            className="absolute inset-0 overflow-hidden rounded-xl border border-line bg-card"
            style={{ clipPath: "polygon(0 0, 50% 52%, 100% 0, 100% 100%, 0 100%)" }}
            initial={false}
            animate={opening ? { opacity: [1, 1, 0] } : { opacity: 1 }}
            transition={t(1.45, 0.45)}
          >
            <div className="airmail absolute inset-x-0 bottom-0 h-2" />
            <div className="absolute inset-x-5 bottom-5 flex items-end justify-between">
              <div className="min-w-0">
                <div className="text-xs text-ink-3">{SENDER_TEXT[sender]}</div>
                <div className="mt-1 truncate font-hand text-xl sm:text-2xl">{subject}</div>
              </div>
              <Stamp sender={sender} />
            </div>
          </motion.div>

          {/* 信封盖：以上沿为轴翻开 */}
          <motion.div
            className="absolute inset-x-0 top-0 h-[56%] origin-top"
            style={{ transformStyle: "preserve-3d" }}
            initial={false}
            animate={opening ? { rotateX: 180, opacity: [1, 1, 0] } : { rotateX: 0, opacity: 1 }}
            transition={t(0.3, 0.65)}
          >
            <div className="h-full w-full bg-paper-2" style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)", filter: "drop-shadow(0 1px 0 var(--line))" }} />
          </motion.div>

          {/* 火漆：裂成两半散开 */}
          <div className="pointer-events-none absolute left-1/2 top-[50%] h-11 w-11 -translate-x-1/2 -translate-y-1/2 sm:h-14 sm:w-14" aria-hidden>
            {[-1, 1].map((side) => (
              <motion.span
                key={side}
                className="absolute inset-0 flex items-center justify-center rounded-full bg-stamp font-hand text-lg text-white shadow-md sm:text-xl"
                style={{ clipPath: side < 0 ? "inset(0 50% 0 0)" : "inset(0 0 0 50%)" }}
                initial={false}
                animate={opening ? { x: side * 18, y: 10, rotate: side * 28, opacity: 0 } : { x: 0, y: 0, rotate: 0, opacity: 1 }}
                transition={t(0, 0.45)}
              >
                邮
              </motion.span>
            ))}
          </div>
        </button>
      </div>

      <p className="mt-8 text-sm text-ink-3">{opening ? "正在拆信…（再点一下跳过）" : <span className="animate-pulse">轻触火漆，拆开这封信</span>}</p>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AnimatePresence, animate, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, ChevronsRight, Mail, X } from "lucide-react";
import { SENDER_TEXT } from "@/components/Postal";
import { cn, fmtCN } from "@/lib/utils";
import { PostmanPipeline } from "./PostmanPipeline";
import { usePostmanRun, type PostmanRequestBody } from "./usePostmanRun";

const DAY = 86_400_000;

/** 日期滚动的时长：天数越多越久，但不拖沓 */
const rollMs = (days: number) => Math.round(Math.min(2200, 700 + Math.log2(days + 1) * 300));

// 光线的方向和速度：固定随机种子，避免每次渲染都跳
const STREAKS = Array.from({ length: 18 }, (_, i) => {
  const angle = (i * 137.5) % 360;
  const r = (angle * Math.PI) / 180;
  return { angle, dx: `${Math.cos(r) * 60}vmax`, dy: `${Math.sin(r) * 60}vmax`, delay: (i % 6) * 0.17 };
});

/**
 * 时光机过场 + 邮差引擎流水线。
 * 快进：日期滚动 → 候选逐条过闸 → 信封飞进信箱 → 列出新来信。巡检（force）没有日期滚动。
 */
export function TimeTravelOverlay({ request, onClose }: { request: PostmanRequestBody; onClose: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const travel = request.action === "forward";
  const hold = travel && !reduced ? rollMs(request.days ?? 1) : 0;
  const run = usePostmanRun({ holdMs: hold, instant: reduced });
  const [waitingLong, setWaitingLong] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);

  // 放到下一拍再开始，开发模式下 effect 连跑两次也只发一次请求（快进会拨时钟，不能重复）
  useEffect(() => {
    const t = setTimeout(() => void run.start(request), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 前面还有邮差动作在排队时，meta 要等轮到这次才来
  useEffect(() => {
    if (run.meta) return;
    const t = setTimeout(() => setWaitingLong(true), 700);
    return () => clearTimeout(t);
  }, [run.meta]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const settled = run.phase === "done" || run.phase === "error";
  const warping = travel && !reduced && !run.skipped && !!run.meta && !settled;

  return createPortal(
    <motion.div
      ref={dialog}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={travel ? "时光机快进" : "邮差巡检"}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="night-scope fixed inset-0 z-[100] overflow-hidden outline-none"
    >
      {warping && (
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {STREAKS.map((s, i) => (
            <span
              key={i}
              className="warp-streak"
              style={{ rotate: `${s.angle}deg`, animationDelay: `${s.delay}s`, ["--dx" as string]: s.dx, ["--dy" as string]: s.dy }}
            />
          ))}
        </div>
      )}

      <div className="relative mx-auto flex h-full max-w-2xl flex-col px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <span className="font-hand text-lg text-ink-2">{travel ? "时光机" : "邮差巡检"}</span>
          {settled ? (
            <button onClick={onClose} className="rounded-full p-2 text-ink-2 hover:bg-card" aria-label="关闭">
              <X size={20} />
            </button>
          ) : (
            <button onClick={run.skip} disabled={run.skipped} className="flex items-center gap-1 rounded-full px-3 py-1.5 text-sm text-ink-2 hover:bg-card disabled:opacity-40">
              跳过动画 <ChevronsRight size={15} />
            </button>
          )}
        </div>

        <header className="shrink-0 py-5 text-center sm:py-8">
          {run.meta ? (
            travel ? (
              <RollingDate from={run.meta.from} to={run.meta.to} duration={run.skipped ? 0 : hold} />
            ) : (
              <div className="font-hand text-3xl">{fmtCN(run.meta.to)}</div>
            )
          ) : (
            <p className="font-hand text-2xl text-ink-2">
              {run.phase === "error" ? (travel ? "时光机没能启动" : "邮差没能出发") : waitingLong ? "邮差正在处理上一件事，马上就到你…" : travel ? "时光机启动中…" : "邮差出发了…"}
            </p>
          )}
        </header>

        {/* 还没开始就失败时没有候选可看，只留下面的错误说明 */}
        {!(run.phase === "error" && !run.order.length) && (
          <PostmanPipeline
            className="min-h-0 flex-1"
            order={run.order}
            decisions={run.decisions}
            running={run.phase === "running"}
            total={run.result?.totalCandidates}
          />
        )}

        <AnimatePresence>
          {settled && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="mt-3 max-h-[45vh] shrink-0 overflow-y-auto">
              {run.phase === "error" ? (
                <div className="card flex items-start gap-3 p-4 text-sm">
                  <AlertCircle size={18} className="mt-0.5 shrink-0 text-stamp" />
                  <div className="flex-1">
                    <p className="text-stamp">{run.error?.message ?? "邮差这一趟没有走完"}</p>
                    <button onClick={onClose} className="btn btn-ghost mt-3 !py-1.5 text-sm">
                      关闭
                    </button>
                  </div>
                </div>
              ) : (
                run.result && <Arrival result={run.result} decisions={run.decisions} animateIn={!reduced && !run.skipped} onClose={onClose} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>,
    document.body,
  );
}

/** 日期从出发那天滚到目的地；duration 为 0 时直接显示终点 */
function RollingDate({ from, to, duration }: { from: string; to: string; duration: number }) {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  const [cur, setCur] = useState(duration ? start : end);
  const days = Math.round((end - start) / DAY);

  useEffect(() => {
    if (!duration) {
      setCur(end);
      return;
    }
    const controls = animate(start, end, { duration: duration / 1000, ease: [0.25, 0.1, 0.25, 1], onUpdate: setCur });
    return () => controls.stop();
  }, [start, end, duration]);

  const d = new Date(cur);
  const passed = Math.round((cur - start) / DAY);
  return (
    <div aria-live="polite">
      <div className="text-sm tracking-widest text-ink-3 tabular-nums">{d.getFullYear()}</div>
      <div className="font-hand text-5xl tabular-nums sm:text-6xl">
        {d.getMonth() + 1}月{d.getDate()}日
      </div>
      <div className="mt-2 text-sm text-gold tabular-nums">
        {passed < days ? `第 ${passed} / ${days} 天` : `时光流过了 ${days} 天`}
      </div>
    </div>
  );
}

/** 信封飞进信箱，然后列出这趟带回来的信 */
function Arrival({
  result,
  decisions,
  animateIn,
  onClose,
}: {
  result: NonNullable<ReturnType<typeof usePostmanRun>["result"]>;
  decisions: ReturnType<typeof usePostmanRun>["decisions"];
  animateIn: boolean;
  onClose: () => void;
}) {
  const written = useMemo(() => result.decisions.filter((d) => d.outcome === "generated" && d.letterId).map((d) => decisions[d.key] ?? d), [result, decisions]);
  const failed = result.decisions.filter((d) => d.outcome === "failed").length;
  const n = result.generated.length + result.delivered.length;
  const flying = Math.min(n, 5);

  return (
    <div className="card p-4">
      <div className="flex items-center gap-4">
        <div className="relative h-16 w-16 shrink-0" aria-hidden>
          {animateIn &&
            Array.from({ length: flying }, (_, i) => (
              <motion.span
                key={i}
                className="absolute left-1/2 top-1/2 -ml-3 -mt-3 text-2xl"
                initial={{ x: (i - (flying - 1) / 2) * 46, y: -150, opacity: 0, rotate: -12 + i * 7 }}
                animate={{ x: 0, y: 0, opacity: [0, 1, 1, 0], rotate: 0, scale: 0.5 }}
                transition={{ delay: i * 0.14, duration: 0.7, ease: "easeIn" }}
              >
                ✉️
              </motion.span>
            ))}
          <motion.span
            className="absolute inset-0 flex items-center justify-center text-5xl"
            animate={animateIn && flying ? { scale: [1, 1, 1.15, 1] } : undefined}
            transition={{ delay: flying * 0.14 + 0.55, duration: 0.35 }}
          >
            📮
          </motion.span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-hand text-xl">{n ? `邮差送来了 ${n} 封信` : "这一趟没有需要写的信"}</h2>
          <p className="mt-0.5 text-xs text-ink-3">
            审视了 {result.totalCandidates} 个候选{failed ? ` · ${failed} 封没写成` : ""}
          </p>
        </div>
      </div>

      {written.length > 0 && (
        <ul className="mt-3 space-y-2">
          {written.map((d) => (
            <li key={d.key}>
              <Link href={`/mailbox/${d.letterId}`} onClick={onClose} className="flex items-start gap-2 rounded-xl border border-line px-3 py-2 text-sm transition hover:bg-paper-2">
                <Mail size={15} className="mt-0.5 shrink-0 text-post" />
                <span className="min-w-0">
                  <span className="text-xs text-ink-3">{SENDER_TEXT[d.sender]}</span>
                  <span className="block line-clamp-2">{d.reason}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {result.delivered.length > 0 && <p className="mt-2 text-xs text-ink-3">另有 {result.delivered.length} 封早就写好、今天到期的信（比如时间胶囊）一起投进了信箱。</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        {n > 0 && (
          <Link href="/mailbox" onClick={onClose} className="btn btn-primary !py-2 text-sm">
            去信箱看看
          </Link>
        )}
        <button onClick={onClose} className={cn("btn !py-2 text-sm", n > 0 ? "btn-ghost" : "btn-primary")}>
          {n > 0 ? "留在这里" : "好的"}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, type Ref } from "react";
import { motion } from "framer-motion";
import { Check, CornerDownRight, Loader2, X } from "lucide-react";
import { ExecutionBadge, fmtDuration } from "@/components/ExecutionBadge";
import { SENDER_TEXT } from "@/components/Postal";
import { cn } from "@/lib/utils";
import type { PostmanDecision, PostmanStageInfo } from "@/lib/types";
import { OUTCOME, STAGE_LABEL, TRIGGER_LABEL } from "./labels";

const TONE = {
  done: "border-post bg-post text-card",
  busy: "border-post/50 bg-post-soft text-post",
  fail: "border-stamp bg-stamp text-card",
  muted: "border-line bg-paper-2 text-ink-3",
};

/** 邮差引擎流水线：每个候选按优先级依次过闸，去向和耗时都来自后端的真实决策 */
export function PostmanPipeline({
  order,
  decisions,
  running,
  total,
  className,
}: {
  order: string[];
  decisions: Record<string, PostmanDecision>;
  running: boolean;
  total?: number;
  className?: string;
}) {
  const end = useRef<HTMLLIElement>(null);
  const last = order[order.length - 1];
  const lastStages = last ? decisions[last]?.stages.length : 0;

  // 新的一条出现或阶段推进时跟着滚动（scrollIntoView 在新版 Chrome 返回 Promise，不能当 effect 返回值）
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [order.length, lastStages]);

  const shown = order.length;
  return (
    <section className={cn("card flex flex-col overflow-hidden", className)}>
      <div className="flex shrink-0 items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-sm font-medium">邮差引擎 · 候选逐条过闸</h2>
        <span className="text-xs text-ink-3 tabular-nums">
          {total !== undefined ? `${shown} / ${total}` : shown ? `${shown} 个` : ""}
        </span>
      </div>
      <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5" aria-live="polite">
        {!shown && (
          <li className="px-2 py-6 text-center text-sm text-ink-3">{running ? "邮差正在翻看你的档案…" : "等待邮差出发…"}</li>
        )}
        {order.map((key, i) => {
          const d = decisions[key];
          if (!d) return null;
          return <Row key={key} d={d} ref={i === order.length - 1 ? end : undefined} />;
        })}
      </ol>
    </section>
  );
}

function Row({ d, ref }: { d: PostmanDecision; ref?: Ref<HTMLLIElement> }) {
  const o = OUTCOME[d.outcome];
  const picked = d.outcome === "selected" || d.outcome === "generated" || d.outcome === "failed" || d.stages.length > 0;
  return (
    <motion.li
      ref={ref}
      layout="position"
      initial={{ opacity: 0, x: -14 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn("rounded-xl border px-3 py-2", picked ? "border-post/40 bg-post-soft/40" : "border-transparent")}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 w-5 shrink-0 text-right text-[11px] text-ink-3 tabular-nums">{d.rank}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-3">
            <span className="rounded bg-paper-2 px-1.5 text-ink-2">{TRIGGER_LABEL[d.type] ?? d.type}</span>
            <span>{SENDER_TEXT[d.sender]}</span>
            <span className="tabular-nums" title="优先级">优先级 {d.priority.toFixed(1)}</span>
          </div>
          <p className={cn("mt-0.5 text-sm leading-6", !picked && "text-ink-2")}>{d.reason}</p>
          {picked && d.stages.length > 0 && <Stages stages={d.stages} failed={d.outcome === "failed"} />}
          {d.outcome === "failed" && d.error && <p className="mt-1 text-xs text-stamp">{d.error.message}</p>}
        </div>
        <span
          title={o.hint}
          className={cn("mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] whitespace-nowrap", TONE[o.tone])}
        >
          {d.outcome === "selected" && <Loader2 size={11} className="animate-spin" />}
          {o.label}
        </span>
      </div>
    </motion.li>
  );
}

function Stages({ stages, failed }: { stages: PostmanStageInfo[]; failed: boolean }) {
  return (
    <ol className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
      {stages.map((s) => (
        <li key={s.name} className="flex items-center gap-1 text-[11px] text-ink-2">
          <span
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded-full border",
              s.status === "completed" && "border-post bg-post text-card",
              s.status === "failed" && "border-stamp bg-stamp text-card",
              s.status === "skipped" && "border-line text-ink-3",
              s.status === "started" && "border-post text-post",
            )}
            aria-hidden
          >
            {s.status === "completed" ? <Check size={10} strokeWidth={3} /> : s.status === "failed" ? <X size={10} strokeWidth={3} /> : s.status === "skipped" ? <CornerDownRight size={9} /> : <Loader2 size={10} className="animate-spin" />}
          </span>
          <span className={cn(s.status === "skipped" && "text-ink-3")}>
            {STAGE_LABEL[s.name]}
            {/* 失败后没跑的阶段也是 skipped；没失败时跳过核查只会是没配模型 */}
            {s.status === "skipped" ? (failed ? "（未执行）" : s.name === "check" ? "（演示模式不核查）" : "（跳过）") : ""}
          </span>
          {s.status !== "started" && s.status !== "skipped" && s.durationMs !== undefined && <span className="text-ink-3 tabular-nums">{fmtDuration(s.durationMs)}</span>}
          {s.execution && s.status !== "started" && <ExecutionBadge info={s.execution} showDuration={false} />}
        </li>
      ))}
    </ol>
  );
}

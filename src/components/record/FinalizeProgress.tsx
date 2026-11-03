"use client";

import { motion } from "framer-motion";
import { Check, CornerDownRight, Loader2, X } from "lucide-react";
import { ExecutionBadge, fmtDuration } from "@/components/ExecutionBadge";
import { cn } from "@/lib/utils";
import type { FinalizeStage } from "@/lib/types";
import type { FinalizePhase, StageMap } from "./useFinalize";

/** 这些阶段在保存记忆之后，失败了也只是部分完成 */
const AFTER_PERSIST: FinalizeStage[] = ["profile", "story"];

export const STAGE_INFO: Array<{ key: FinalizeStage; label: string; hint: string }> = [
  { key: "extract", label: "读懂这一天", hint: "抽取事件、人物、地点和计划" },
  { key: "embed", label: "生成记忆向量", hint: "以后靠它想起相关的事" },
  { key: "persist", label: "存进记忆库", hint: "记忆和实体关系一起保存" },
  { key: "profile", label: "更新你的画像", hint: "你在意的人、常去的地方、说话的样子" },
  { key: "story", label: "写故事卡片", hint: "把这一天写成一张小卡片" },
];

const HEAD: Record<FinalizePhase, string> = {
  idle: "准备收进邮局…",
  running: "邮差正在整理这一天…",
  completed: "整理好了",
  partial: "记忆已经存好，有一步没完成",
  failed: "整理到一半出了问题",
};

/** 收进邮局的五个真实阶段：状态、耗时、执行方式都来自后端，不估算百分比 */
export function FinalizeProgress({
  phase,
  stages,
  reused,
  reconnecting,
}: {
  phase: FinalizePhase;
  stages: StageMap;
  reused: boolean;
  reconnecting: boolean;
}) {
  const total = Object.values(stages).reduce((a, s) => a + (s?.durationMs ?? 0), 0);
  const settled = phase === "completed" || phase === "partial";

  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between gap-3" role="status" aria-live="polite">
        <h2 className="font-hand text-xl">{reconnecting ? "连接断了，正在查询进度…" : HEAD[phase]}</h2>
        {settled && total > 0 && <span className="shrink-0 text-xs text-ink-3">共 {fmtDuration(total)}</span>}
      </div>
      {reused && <p className="mt-1 text-xs text-ink-3">这条记录之前处理过：已完成的步骤直接沿用，记忆不会重复保存。</p>}

      <ol className="mt-4 space-y-1">
        {STAGE_INFO.map(({ key, label, hint }, i) => {
          const s = stages[key];
          const status = s?.status;
          return (
            <motion.li
              key={key}
              initial={false}
              animate={{ opacity: status ? 1 : 0.55 }}
              className="flex items-start gap-3 rounded-xl px-2 py-2"
            >
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs",
                  status === "completed" && "border-post bg-post text-card",
                  status === "skipped" && "border-post/40 bg-post-soft text-post",
                  status === "failed" && "border-stamp bg-stamp text-card",
                  status === "started" && "border-post text-post",
                  !status && "border-line text-ink-3",
                )}
                aria-hidden
              >
                {status === "completed" ? (
                  <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }}>
                    <Check size={14} strokeWidth={3} />
                  </motion.span>
                ) : status === "skipped" ? (
                  <CornerDownRight size={13} />
                ) : status === "failed" ? (
                  <X size={14} strokeWidth={3} />
                ) : status === "started" ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  i + 1
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className={cn("text-sm", status === "failed" && "text-stamp")}>{label}</span>
                  {status === "skipped" && <span className="text-[11px] text-ink-3">沿用已保存的结果</span>}
                  {status === "failed" && <span className="text-[11px] text-stamp">失败</span>}
                  {(status === "completed" || status === "failed") && s?.durationMs !== undefined && (
                    <span className="text-[11px] text-ink-3">{fmtDuration(s.durationMs)}</span>
                  )}
                  {s?.execution && status !== "started" && <ExecutionBadge info={s.execution} showDuration={false} />}
                </div>
                <p className={cn("text-xs", status === "failed" ? "text-stamp/80" : "text-ink-3")}>
                  {status !== "failed" ? hint : AFTER_PERSIST.includes(key) ? "这一步没完成，记忆已经安全保存，可以单独重试" : "这一步没完成，你的对话都还在，可以重试"}
                </p>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}

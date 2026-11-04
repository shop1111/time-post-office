"use client";

import { Check, Loader2 } from "lucide-react";
import type { FinalizePhase, StageMap } from "./useFinalize";
import type { FinalizeStage } from "@/lib/types";

// Technical stages stay available for internal diagnostics, not the normal user flow.
export const STAGE_INFO: Array<{ key: FinalizeStage; label: string }> = [
  { key: "extract", label: "整理内容" }, { key: "embed", label: "整理内容" },
  { key: "persist", label: "保存内容" }, { key: "profile", label: "更新记忆" }, { key: "story", label: "整理回忆" },
];

export function FinalizeProgress({ phase, reconnecting }: {
  phase: FinalizePhase; stages: StageMap; reused: boolean; reconnecting: boolean;
}) {
  const complete = phase === "completed";
  const title = complete ? "胶囊保存好了" : phase === "partial" ? "胶囊已保存，整理还有一点没完成" : phase === "failed" ? "整理暂时没完成" : reconnecting ? "正在确认保存结果…" : "正在整理这颗胶囊…";
  return <div className="card flex items-start gap-3 p-5" role="status" aria-live="polite">
    {complete ? <Check size={20} className="mt-1 text-post" /> : <Loader2 size={20} className={phase === "running" ? "mt-1 animate-spin text-post" : "mt-1 text-ink-3"} />}
    <div><h2 className="font-hand text-xl">{title}</h2><p className="mt-1 text-xs leading-6 text-ink-3">{complete ? "可以在胶囊里回看这次记录和聊天。" : "原始记录和已经发送的话都已保留。"}</p></div>
  </div>;
}

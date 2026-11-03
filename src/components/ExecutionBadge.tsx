import { Cloud, CloudOff, Laptop } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ExecutionInfo } from "@/lib/types";

/** 降级原因的大白话；没列到的 HTTP 状态原样显示，不把鉴权失败说成网络问题 */
const REASONS: Record<string, string> = {
  timeout: "超时",
  http_429: "被限流",
  http_5xx: "服务出错",
  network: "网络中断",
  bad_json: "返回格式不对",
  not_configured: "未配置模型",
  http_401: "Key 无效",
  http_403: "没有权限",
  http_404: "地址或模型名不对",
};

export const reasonText = (reason?: string) => (reason ? (REASONS[reason] ?? reason) : "未知原因");

export function fmtDuration(ms: number) {
  return ms < 1000 ? `${Math.max(0, Math.round(ms))} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
}

/** 「真实模型 / 本地演示 / 已降级」小标记，数据来自后端的 execution，不做任何推测 */
export function ExecutionBadge({ info, showDuration = true, className }: { info: ExecutionInfo; showDuration?: boolean; className?: string }) {
  const remote = info.mode === "remote";
  const fallback = info.mode === "fallback";
  const Icon = remote ? Cloud : fallback ? CloudOff : Laptop;
  const label = remote ? (info.model ?? "真实模型") : fallback ? `已降级 · ${reasonText(info.fallbackReason)}` : info.model === "lite" ? "本地向量" : "本地演示";
  const title = remote
    ? `由真实模型 ${info.model ?? ""} 生成`
    : fallback
      ? `远程模型没有完成（${reasonText(info.fallbackReason)}），这一步改用本地规则生成`
      : "没有配置模型 Key，用本地规则生成（演示模式）";
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[11px] leading-4 whitespace-nowrap",
        remote ? "border-post/30 bg-post-soft text-post" : fallback ? "border-gold/40 bg-gold/10 text-gold" : "border-line bg-paper-2 text-ink-3",
        className,
      )}
    >
      <Icon size={11} aria-hidden />
      {label}
      {showDuration && <span className="opacity-70">· {fmtDuration(info.durationMs)}</span>}
    </span>
  );
}

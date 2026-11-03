import { AlertTriangle, CircleDashed, PenLine, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CheckStatus } from "@/lib/types";

const META: Record<CheckStatus, { label: string; icon: typeof ShieldCheck; cls: string; fallback: string }> = {
  passed: { label: "事实核查通过", icon: ShieldCheck, cls: "border-post/40 bg-post-soft text-post", fallback: "信里的说法都能在你的记忆里找到依据" },
  rewritten: { label: "核查后改写过", icon: PenLine, cls: "border-post/40 bg-post-soft text-post", fallback: "有些说法找不到依据，已经改写并复检通过" },
  unchecked: { label: "未核查", icon: CircleDashed, cls: "border-line bg-paper-2 text-ink-3", fallback: "这封信没有做事实核查" },
  failed: { label: "核查未通过", icon: AlertTriangle, cls: "border-stamp/40 bg-stamp-soft text-stamp", fallback: "改写后仍有无法核实的说法，请谨慎阅读" },
};

/** 事实核查徽章：如实显示后端记录的状态，不做任何推测 */
export function CheckBadge({ status, note, className }: { status: CheckStatus; note: string; className?: string }) {
  const m = META[status] ?? META.unchecked;
  const Icon = m.icon;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]", m.cls)}>
        <Icon size={12} aria-hidden /> {m.label}
      </span>
      <span className="text-[11px] text-ink-3">{note || m.fallback}</span>
    </div>
  );
}

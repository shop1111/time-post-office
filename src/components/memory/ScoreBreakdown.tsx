/** 检索得分拆解：得分 = Σ 权重 × 分项（参考 Generative Agents），让「为什么想起这条」看得见 */
import { DEFAULT_WEIGHTS, type RankWeights } from "@/lib/memory/rank";
import { cn } from "@/lib/utils";

export interface ScoreParts {
  sim: number;
  recency: number;
  importance: number;
  entity: number;
}

const ROWS = [
  { key: "sim", label: "语义相似", why: "内容和这次很像", color: "var(--post)" },
  { key: "entity", label: "人物地点", why: "提到了同一个人或地方", color: "var(--stamp)" },
  { key: "importance", label: "重要程度", why: "这件事对你很重要", color: "var(--gold)" },
  { key: "recency", label: "时间新近", why: "发生得不久", color: "var(--ink-3)" },
] as const;

export function ScoreBreakdown({
  parts,
  score,
  weights = DEFAULT_WEIGHTS,
  compact,
  className,
}: {
  parts: ScoreParts;
  score: number;
  weights?: RankWeights;
  compact?: boolean;
  className?: string;
}) {
  const rows = ROWS.map((r) => ({ ...r, weight: weights[r.key], value: weights[r.key] * parts[r.key] }));
  const total = rows.reduce((s, r) => s + r.weight, 0) || 1;
  const maxWeight = Math.max(...rows.map((r) => r.weight)) || 1;
  const top = [...rows].sort((a, b) => b.value - a.value)[0];

  const stacked = (
    <div className="flex h-2 overflow-hidden rounded-full bg-paper-2" aria-hidden>
      {rows.map((r) => (
        <span key={r.key} className="h-full" style={{ width: `${(r.value / total) * 100}%`, background: r.color }} />
      ))}
    </div>
  );

  if (compact) {
    return (
      <div className={cn("space-y-1", className)}>
        {stacked}
        <div className="flex justify-between text-[11px] text-ink-3">
          <span>主要因为：{top.why}</span>
          <span className="font-mono">{score.toFixed(2)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("text-[11px] text-ink-2", className)}>
      <div className="mb-2 flex items-baseline justify-between">
        <span>
          主要因为：<span className="text-ink">{top.why}</span>
        </span>
        <span className="font-mono text-ink-3">得分 {score.toFixed(2)}</span>
      </div>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.key} className="grid grid-cols-[4.5rem_1fr_2.75rem] items-center gap-2">
            <span>{r.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-paper-2">
              <span className="block h-full rounded-full" style={{ width: `${(r.value / maxWeight) * 100}%`, background: r.color }} />
            </span>
            <span className="text-right font-mono">+{r.value.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] leading-4 text-ink-3">
        得分 = {rows.map((r) => `${r.weight}×${r.label}`).join(" + ")}
      </p>
    </div>
  );
}

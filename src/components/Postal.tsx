/** 邮政视觉元素：邮票、邮戳 */
import { cn } from "@/lib/utils";

const SENDER_STAMP: Record<string, { bg: string; icon: string; label: string }> = {
  past_self: { bg: "#c98a6b", icon: "🕰️", label: "过去" },
  future_self: { bg: "#5b7fa8", icon: "🌙", label: "未来" },
  postman: { bg: "#2f5d62", icon: "📮", label: "邮差" },
  user: { bg: "#c0483a", icon: "💌", label: "胶囊" },
};

export function Stamp({ sender, className }: { sender: string; className?: string }) {
  const s = SENDER_STAMP[sender] ?? SENDER_STAMP.postman;
  return (
    <div className={cn("stamp-edge shrink-0", className)} style={{ width: 54, height: 64 }}>
      <div className="flex h-full w-full flex-col items-center justify-center rounded-[2px] text-white" style={{ background: s.bg }}>
        <span className="text-xl leading-none">{s.icon}</span>
        <span className="mt-1 text-[9px] tracking-widest opacity-90">{s.label}</span>
      </div>
    </div>
  );
}

export function Postmark({ date, label = "时光邮局", className }: { date: Date | string; label?: string; className?: string }) {
  const d = new Date(date);
  return (
    <svg viewBox="0 0 100 100" className={cn("h-20 w-20 rotate-[-12deg] opacity-80", className)} aria-label={`邮戳 ${d.toLocaleDateString()}`}>
      <defs>
        <path id="pm-top" d="M 18 50 A 32 32 0 0 1 82 50" />
      </defs>
      <circle cx="50" cy="50" r="44" fill="none" stroke="var(--stamp)" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="36" fill="none" stroke="var(--stamp)" strokeWidth="1" />
      <text fontSize="10" fill="var(--stamp)" letterSpacing="3">
        <textPath href="#pm-top" startOffset="50%" textAnchor="middle">
          {label}
        </textPath>
      </text>
      <line x1="16" y1="54" x2="84" y2="54" stroke="var(--stamp)" strokeWidth="1" />
      <text x="50" y="67" fontSize="11" textAnchor="middle" fill="var(--stamp)" fontFamily="monospace" fontWeight="bold">
        {d.getFullYear()}.{String(d.getMonth() + 1).padStart(2, "0")}.{String(d.getDate()).padStart(2, "0")}
      </text>
      <text x="50" y="78" fontSize="7" textAnchor="middle" fill="var(--stamp)">
        TIME POST
      </text>
    </svg>
  );
}

export const SENDER_TEXT: Record<string, string> = {
  past_self: "来自过去的你",
  future_self: "来自未来的你",
  postman: "来自时光邮差",
  user: "来自从前的你（时间胶囊）",
};

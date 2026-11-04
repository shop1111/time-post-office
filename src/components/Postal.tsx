/** 邮政视觉元素：邮票、邮戳 */
import { cn } from "@/lib/utils";

/** 邮票样式按「谁写的信」区分；kind 是收件人类型 */
const STAMP: Record<string, { bg: string; icon: string; label: string }> = {
  curator: { bg: "#2f5d62", icon: "📮", label: "小局" },
  person: { bg: "#c98a6b", icon: "✉️", label: "回信" },
  parallel_self: { bg: "#7a6aa8", icon: "🪐", label: "平行" },
  future_self: { bg: "#c0483a", icon: "💌", label: "自己" },
  user: { bg: "#8a9aa8", icon: "✍️", label: "寄出" },
  legacy: { bg: "#a39a8a", icon: "🕰️", label: "旧信" },
};

export interface LetterParty {
  sender: string;
  /** 收件人（往来的另一方）的类型和名字 */
  kind?: string | null;
  name?: string | null;
}

function stampKey({ sender, kind }: LetterParty) {
  if (sender === "curator" || sender === "postman") return "curator";
  if (sender === "persona") return kind === "parallel_self" ? "parallel_self" : "person";
  if (sender === "user") return kind === "future_self" ? "future_self" : "user";
  return "legacy";
}

export function Stamp({ party, className }: { party: LetterParty; className?: string }) {
  const s = STAMP[stampKey(party)];
  return (
    <div className={cn("stamp-edge shrink-0", className)} style={{ width: 54, height: 64 }}>
      <div className="flex h-full w-full flex-col items-center justify-center rounded-[2px] text-white" style={{ background: s.bg }}>
        <span className="text-xl leading-none">{s.icon}</span>
        <span className="mt-1 text-[9px] tracking-widest opacity-90">{s.label}</span>
      </div>
    </div>
  );
}

/** 信封上的「来自 / 寄给」一行 */
export function senderText(p: LetterParty, writtenAt?: string | Date) {
  switch (stampKey(p)) {
    case "curator":
      return "来自小局（邮局主理人）";
    case "person":
      return `来自${p.name ?? "TA"} · agent 代笔`;
    case "parallel_self":
      return `来自${p.name ?? "平行时空的你"} · agent 代笔`;
    case "future_self":
      return writtenAt ? `来自${fmt(writtenAt)}的你` : "来自从前的你";
    case "user":
      return `寄给${p.name ?? "TA"}`;
    default:
      return "旧版来信";
  }
}

const fmt = (d: string | Date) => {
  const x = new Date(d);
  return `${x.getFullYear()}年${x.getMonth() + 1}月${x.getDate()}日`;
};

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

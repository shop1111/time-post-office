"use client";

import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { cn, fmtCN, photoUrl } from "@/lib/utils";
import { Postmark } from "./Postal";

export interface StoryCardData {
  title: string;
  narrative: string;
  quote: string;
  template: string;
  date: string;
  place?: string | null;
  photoPath?: string | null;
}

/** 故事卡片：四种模板，可导出为图片分享 */
export function StoryCard({ c, compact, exportable }: { c: StoryCardData; compact?: boolean; exportable?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const img = photoUrl(c.photoPath);

  async function save() {
    if (!ref.current) return;
    setBusy(true);
    try {
      const { toPng } = await import("html-to-image");
      const url = await toPng(ref.current, { pixelRatio: 2, cacheBust: true });
      const a = document.createElement("a");
      a.href = url;
      a.download = `时光邮局-${c.title}.png`;
      a.click();
    } finally {
      setBusy(false);
    }
  }

  const meta = (
    <div className="flex items-center gap-2 text-[11px] opacity-70">
      <span>{fmtCN(c.date)}</span>
      {c.place && <span>· {c.place}</span>}
    </div>
  );

  let body: React.ReactNode;
  if (c.template === "night") {
    body = (
      <div className="relative overflow-hidden rounded-2xl p-6 text-[#efe9dc]" style={{ background: "linear-gradient(160deg,#1f2a44,#2d2440 70%,#3a2a3a)" }}>
        <Stars />
        {meta}
        <h3 className="mt-3 font-hand text-2xl">{c.title}</h3>
        {!compact && <p className="mt-3 font-serif-cn text-[15px] leading-8 opacity-90">{c.narrative}</p>}
        <p className="mt-4 border-l-2 border-[#e0b25f] pl-3 font-hand text-lg text-[#f3d9a4]">{c.quote}</p>
      </div>
    );
  } else if (c.template === "film") {
    body = (
      <div className="rounded-2xl bg-[#1d1b19] p-3 text-[#efe6d6]">
        <Sprockets />
        <div className="my-2 overflow-hidden rounded-md">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt={c.title} className={cn("w-full object-cover sepia-[.15]", compact ? "h-36" : "h-56")} />
          ) : (
            <div className={cn("w-full bg-gradient-to-br from-[#c98a6b] to-[#5b4a6e]", compact ? "h-24" : "h-40")} />
          )}
        </div>
        <Sprockets />
        <div className="px-2 pb-2 pt-3">
          {meta}
          <h3 className="mt-2 font-hand text-2xl">{c.title}</h3>
          {!compact && <p className="mt-2 font-serif-cn text-[15px] leading-8 opacity-85">{c.narrative}</p>}
          <p className="mt-3 font-hand text-lg text-[#e0b25f]">「{c.quote}」</p>
        </div>
      </div>
    );
  } else if (c.template === "postcard") {
    body = (
      <div className="relative rounded-2xl border border-line bg-card p-3 shadow-[var(--shadow)]">
        {img && (
          <div className="relative overflow-hidden rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img} alt={c.title} className={cn("w-full object-cover", compact ? "h-40" : "h-64")} />
            <Postmark date={c.date} label={c.place ?? "时光邮局"} className="absolute -bottom-3 right-2 h-20 w-20 text-white" />
          </div>
        )}
        <div className="px-2 pb-2 pt-4 text-ink">
          {meta}
          <h3 className="mt-2 font-hand text-2xl">{c.title}</h3>
          {!compact && <p className="mt-2 font-serif-cn text-[15px] leading-8 text-ink-2">{c.narrative}</p>}
          <p className="mt-3 font-hand text-lg text-stamp">「{c.quote}」</p>
        </div>
      </div>
    );
  } else {
    body = (
      <div className="letter-paper relative rounded-2xl border border-line px-6 py-5 text-ink shadow-[var(--shadow)]">
        <div className="leading-normal">{meta}</div>
        <h3 className="font-hand text-2xl leading-[36px]">{c.title}</h3>
        {!compact && <p className="font-serif-cn text-[15px] leading-[36px] text-ink-2">{c.narrative}</p>}
        <p className="font-hand text-lg leading-[36px] text-stamp">「{c.quote}」</p>
        {img && compact && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" className="mt-2 h-28 w-full rounded-lg object-cover" />
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <div ref={ref} className="bg-transparent">
        {body}
      </div>
      {exportable && (
        <button onClick={save} disabled={busy} className="btn btn-ghost mt-3 text-xs">
          <Download size={14} /> {busy ? "正在冲印…" : "保存为图片"}
        </button>
      )}
    </div>
  );
}

function Sprockets() {
  return (
    <div className="flex justify-between px-1">
      {Array.from({ length: 14 }, (_, i) => (
        <span key={i} className="h-2 w-3 rounded-[2px] bg-[#efe6d6]/80" />
      ))}
    </div>
  );
}

function Stars() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      {Array.from({ length: 28 }, (_, i) => (
        <circle key={i} cx={`${(i * 37) % 100}%`} cy={`${(i * 53) % 100}%`} r={i % 5 === 0 ? 1.4 : 0.8} fill="#fff" opacity={0.25 + (i % 4) * 0.12} />
      ))}
    </svg>
  );
}

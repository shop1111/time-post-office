"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn, fmtCN } from "@/lib/utils";
import type { LetterSentenceSources, LetterSource } from "@/lib/types";

// 逐字浮现：每个字最多隔 16 毫秒，整封信最多 3.2 秒浮现完
const MAX_STEP_MS = 16;
const MAX_TOTAL_MS = 3200;

const STATE_NOTE: Record<LetterSource["state"], string | null> = {
  current: null,
  corrected: "这条回忆后来被你更正过，下面是写信时的原文",
  withdrawn: "这条回忆已被你撤回，下面是写信时的原文",
};

interface Pop {
  i: number;
  top: number;
  left: number;
  width: number;
}

/**
 * 信的正文。句子来自后端的无损分句（拼起来正好是原文），有出处的句子画虚线，点开看原文和日期。
 * reveal 为 true 时逐字浮现；reading 是正在朗读的句子。
 */
export function LetterBody({ sentences, reveal, reading }: { sentences: LetterSentenceSources[]; reveal: boolean; reading: number }) {
  const [revealing, setRevealing] = useState(reveal);
  const [pop, setPop] = useState<Pop | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);

  const total = useMemo(() => sentences.reduce((n, s) => n + s.text.length, 0), [sentences]);
  const step = Math.min(MAX_STEP_MS, MAX_TOTAL_MS / Math.max(1, total));
  const anySource = sentences.some((s) => s.sources.length);

  useEffect(() => {
    if (!revealing) return;
    const t = setTimeout(() => setRevealing(false), total * step + 600);
    return () => clearTimeout(t);
  }, [revealing, total, step]);

  useEffect(() => {
    if (!pop) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setPop(null);
    // 点卡片以外的地方关掉；点别的带虚线句子交给 openSource 切换
    const outside = (e: PointerEvent) => {
      const el = e.target as Element;
      if (!card.current?.contains(el) && !el.closest("[data-cited]")) setPop(null);
    };
    window.addEventListener("keydown", close);
    document.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", outside);
    };
  }, [pop]);

  function openSource(i: number, e: MouseEvent<HTMLSpanElement>) {
    if (pop?.i === i) return setPop(null);
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    // 一句话可能折成好几行：贴着点到的那一行下方弹出
    const rects = [...e.currentTarget.getClientRects()];
    const line = rects.find((r) => e.clientY >= r.top && e.clientY <= r.bottom) ?? rects[rects.length - 1];
    const width = Math.min(360, box.width - 16);
    const left = Math.max(8, Math.min(line.left - box.left, box.width - width - 8));
    setPop({ i, top: line.bottom - box.top + 6, left, width });
  }

  let offset = 0;
  return (
    <div ref={wrap} className="relative mx-3 mb-3 mt-6">
      <div className="letter-paper whitespace-pre-wrap rounded-xl px-5 py-[14px] font-hand text-[18px] md:px-8">
        {sentences.map((s, i) => {
          const start = offset;
          offset += s.text.length;
          const cited = s.sources.length > 0;
          return (
            <span
              key={i}
              data-cited={cited || undefined}
              onClick={cited ? (e) => openSource(i, e) : undefined}
              className={cn(
                // 上下内边距补满 36px 行高：折行的句子行与行之间也点得中，高亮也连成整行
                "rounded-sm py-[6px] transition-colors [box-decoration-break:clone]",
                cited && "cursor-pointer underline decoration-ink-3/70 decoration-dotted decoration-[1.5px] underline-offset-[7px] hover:bg-gold/10",
                pop?.i === i && "bg-gold/15",
                reading === i && "bg-post-soft",
              )}
            >
              {revealing
                ? Array.from(s.text, (ch, k) => (
                    <span key={k} className="ink-in" style={{ animationDelay: `${Math.round((start + k) * step)}ms` }}>
                      {ch}
                    </span>
                  ))
                : s.text}
            </span>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-2 text-[11px] text-ink-3">
        <span>{anySource ? "带虚线的句子能找到你当时写下的原文，点一下看看。" : ""}</span>
        {revealing && (
          <button onClick={() => setRevealing(false)} className="hover:text-ink">
            直接看全文
          </button>
        )}
      </div>

      <AnimatePresence>
        {pop && (
          <motion.div
            key={pop.i}
            ref={card}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            role="dialog"
            aria-label="这句话的出处"
            className="card absolute z-20 p-3 text-sm"
            style={{ top: pop.top, left: pop.left, width: pop.width }}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-2">这句话的出处</span>
              <button onClick={() => setPop(null)} className="rounded-full p-1 text-ink-3 hover:bg-paper-2" aria-label="关闭">
                <X size={14} />
              </button>
            </div>
            <ul className="mt-2 space-y-3">
              {sentences[pop.i].sources.map((src) => (
                <li key={src.memoryId}>
                  <div className="text-[11px] text-ink-3">{fmtCN(src.date)}，你写下：</div>
                  <blockquote className="mt-1 border-l-2 border-gold/60 pl-2 font-hand text-[15px] leading-7">「{src.excerpt}」</blockquote>
                  {STATE_NOTE[src.state] && (
                    <p className={cn("mt-1 text-[11px]", src.state === "withdrawn" ? "text-stamp" : "text-gold")}>{STATE_NOTE[src.state]}</p>
                  )}
                  {src.entryId && src.state !== "withdrawn" && (
                    <Link href={`/entry/${src.entryId}`} className="mt-1 inline-block text-xs text-post hover:underline">
                      看那天的记录 →
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-line pt-2 text-[10px] text-ink-3">出处是程序按文字逐字比对找到的，不是模型的复述。</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

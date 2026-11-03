"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Download, RefreshCw } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceLine } from "recharts";
import type { RecapPayload } from "@/lib/story";
import { fmtCN, photoUrl } from "@/lib/utils";

export function RecapView({ month, initial }: { month: string; initial: RecapPayload | null }) {
  const [recap, setRecap] = useState<RecapPayload | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [empty, setEmpty] = useState(false);
  const [saving, setSaving] = useState(false);
  const poster = useRef<HTMLDivElement>(null);

  async function build() {
    setLoading(true);
    const r = await fetch(`/api/recap/${month}`, { method: "POST" }).then((r) => r.json());
    setRecap(r.recap);
    setEmpty(!r.recap);
    setLoading(false);
  }

  useEffect(() => {
    if (!initial) build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function save() {
    if (!poster.current) return;
    setSaving(true);
    const { toPng } = await import("html-to-image");
    const url = await toPng(poster.current, { pixelRatio: 2, cacheBust: true });
    const a = document.createElement("a");
    a.href = url;
    a.download = `时光邮局-${month}-月度回忆.png`;
    a.click();
    setSaving(false);
  }

  if (loading)
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-ink-2">
        <motion.div animate={{ rotateY: [0, 180, 360] }} transition={{ repeat: Infinity, duration: 2 }} className="text-5xl">
          📖
        </motion.div>
        <p className="font-hand text-lg">邮差正在翻阅这个月的信件…</p>
        <p className="text-xs text-ink-3">统计情绪曲线 · 找出高光时刻 · 写一段月度叙事</p>
      </div>
    );
  if (empty || !recap)
    return <p className="mt-16 text-center text-ink-3">这个月没有寄存任何生活。</p>;

  const s = recap.stats;
  return (
    <div className="mt-4 space-y-6">
      <div ref={poster} className="space-y-6 rounded-3xl bg-paper p-1">
        {/* 封面 */}
        <section className="relative overflow-hidden rounded-3xl p-6 text-white md:p-8" style={{ background: "linear-gradient(135deg,#c0483a,#c98a6b 55%,#e0b25f)" }}>
          <div className="text-sm opacity-80">{month.replace("-", " · ")} 月度回忆</div>
          <h1 className="mt-2 font-hand text-4xl md:text-5xl">{recap.title}</h1>
          <div className="mt-4 flex flex-wrap gap-2">
            {recap.keywords.map((k) => (
              <span key={k} className="rounded-full bg-white/20 px-3 py-0.5 text-sm">
                #{k}
              </span>
            ))}
          </div>
          <div className="mt-6 grid grid-cols-3 gap-3 text-center">
            <Stat n={s.count} label="段生活" />
            <Stat n={s.photos.length} label="张照片" />
            <Stat n={s.topPeople.length} label="个重要的人" />
          </div>
          {s.photos.length > 0 && (
            <div className="pointer-events-none absolute -right-6 -top-6 hidden rotate-6 gap-2 opacity-90 md:flex">
              {s.photos.slice(0, 2).map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.entryId} src={photoUrl(p.photoPath)!} alt="" className="h-28 w-24 rounded-md border-4 border-white object-cover shadow-lg" />
              ))}
            </div>
          )}
        </section>

        {/* 叙事 */}
        <section className="letter-paper rounded-2xl border border-line px-6 py-[14px] font-hand text-[18px] md:px-8">{recap.narrative}</section>

        {/* 情绪曲线 */}
        {s.moodSeries.length > 1 && (
          <section className="card p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-hand text-xl">情绪天气</h2>
              <span className="text-xs text-ink-3">平均 {s.avgMood > 0 ? "+" : ""}{s.avgMood}</span>
            </div>
            <div className="mt-3 h-44">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={s.moodSeries} margin={{ top: 8, right: 8, bottom: 0, left: -28 }}>
                  <defs>
                    <linearGradient id="mood" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#e0b25f" stopOpacity={0.6} />
                      <stop offset="100%" stopColor="#5b7fa8" stopOpacity={0.15} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" tickFormatter={(d) => `${d}日`} tick={{ fontSize: 11, fill: "var(--ink-3)" }} axisLine={false} tickLine={false} />
                  <YAxis domain={[-1, 1]} ticks={[-1, 0, 1]} tickFormatter={(v) => (v > 0 ? "☀️" : v < 0 ? "🌧" : "☁️")} tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
                  <ReferenceLine y={0} stroke="var(--line)" />
                  <Tooltip
                    contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, fontSize: 12 }}
                    formatter={(v) => [Number(v).toFixed(2), "情绪"]}
                    labelFormatter={(d, p) => `${d}日 · ${p?.[0]?.payload?.title ?? ""}`}
                  />
                  <Area type="monotone" dataKey="mood" stroke="#c98a6b" strokeWidth={2} fill="url(#mood)" dot={{ r: 3, fill: "#c0483a" }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* 高光 */}
        {recap.highlights.length > 0 && (
          <section>
            <h2 className="mb-3 font-hand text-xl">本月高光</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              {recap.highlights.map((h) => (
                <Link key={h.memoryId} href={h.entryId ? `/entry/${h.entryId}` : "#"} className="card overflow-hidden transition hover:-translate-y-0.5">
                  {h.photoPath && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl(h.photoPath)!} alt="" className="h-28 w-full object-cover" />
                  )}
                  <div className="p-3">
                    <div className="text-[11px] text-ink-3">{fmtCN(h.date, false)}</div>
                    <p className="mt-1 text-sm">{h.content}</p>
                    <p className="mt-2 font-hand text-sm text-stamp">{h.line}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-3 sm:grid-cols-2">
          <Rank title="常出现的人" items={s.topPeople} icon="👤" />
          <Rank title="去过的地方" items={s.topPlaces} icon="📍" />
        </section>

        {recap.nextMonthNote && (
          <section className="rounded-2xl border border-dashed border-gold/60 p-5 text-center">
            <div className="text-xs text-ink-3">给下个月的你</div>
            <p className="mt-2 font-hand text-xl">{recap.nextMonthNote}</p>
          </section>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          <Download size={14} /> {saving ? "正在冲印…" : "保存为分享长图"}
        </button>
        <button className="btn btn-ghost" onClick={build}>
          <RefreshCw size={14} /> 重新生成
        </button>
      </div>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-2xl bg-white/15 py-3">
      <div className="text-3xl font-bold">{n}</div>
      <div className="text-xs opacity-80">{label}</div>
    </div>
  );
}

function Rank({ title, items, icon }: { title: string; items: Array<{ name: string; count: number }>; icon: string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  return (
    <div className="card p-5">
      <h3 className="font-hand text-lg">{title}</h3>
      {items.length === 0 && <p className="mt-2 text-sm text-ink-3">—</p>}
      <ul className="mt-3 space-y-2">
        {items.map((i) => (
          <li key={i.name} className="flex items-center gap-2 text-sm">
            <span className="w-20 shrink-0 truncate">
              {icon} {i.name}
            </span>
            <span className="h-2 rounded-full bg-stamp/70" style={{ width: `${(i.count / max) * 100}%` }} />
            <span className="text-xs text-ink-3">{i.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

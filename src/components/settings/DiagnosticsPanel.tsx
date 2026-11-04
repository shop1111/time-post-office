"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Database, Loader2, RefreshCw } from "lucide-react";
import { ExecutionBadge, fmtDuration, reasonText } from "@/components/ExecutionBadge";
import { cn, fmtCN } from "@/lib/utils";
import type { AiCapability, AiRole, DiagnosticsPingResponse, DiagnosticsResponse } from "@/lib/types";

const ROLE: Record<AiRole, { label: string; env: string }> = {
  chat: { label: "对话 / 写信", env: "CHAT_*" },
  vision: { label: "看图", env: "VISION_*" },
  embed: { label: "向量", env: "EMBED_*" },
  asr: { label: "语音转写", env: "ASR_*" },
  tts: { label: "朗读", env: "TTS_*" },
};

const PURPOSE: Record<string, string> = {
  interview: "追问",
  extract: "抽取记忆",
  embed: "生成向量",
  profile: "更新画像",
  story: "故事卡片",
  letter: "写信",
  check: "事实核查",
  reply: "回信判断",
  recap: "月度回忆",
  tts: "朗读",
  demo: "载入示例",
  ping: "体检测试",
};

const REFRESH_MS = 10_000;

type PingState = { busy: boolean; text?: string; tone?: "ok" | "muted" | "fail" };

/** 体检面板：配置是否齐全、最近 30 次 AI 调用走的是真模型 / 本地演示 / 降级，以及一键测连通 */
export function DiagnosticsPanel({ initial }: { initial: DiagnosticsResponse }) {
  const [d, setD] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // 不能在首屏用 Date.now()：服务端和浏览器渲染时差几秒，会导致水合不一致；第一次刷新后再显示时间
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [pings, setPings] = useState<Partial<Record<"chat" | "embed", PingState>>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/diagnostics", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setD(await r.json());
      setFailed(false);
      setCheckedAt(Date.now());
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // 页面在前台时每 10 秒刷新一次，切到后台就停
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && void refresh();
    const t = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  async function ping(role: "chat" | "embed") {
    setPings((p) => ({ ...p, [role]: { busy: true } }));
    let next: PingState;
    try {
      const r = await fetch("/api/diagnostics/ping", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
      const data = await r.json();
      if (r.status === 429) next = { busy: false, text: "5 秒内只能测一次，稍等再试", tone: "muted" };
      else if (!r.ok) next = { busy: false, text: data.error ?? "体检暂时失败", tone: "fail" };
      else {
        const { ok, execution } = data as DiagnosticsPingResponse;
        next = ok
          ? { busy: false, text: `连通 · ${fmtDuration(execution.durationMs)}`, tone: "ok" }
          : execution.fallbackReason === "not_configured"
            ? { busy: false, text: "没有配置，未发请求", tone: "muted" }
            : { busy: false, text: `不通 · ${reasonText(execution.fallbackReason)}`, tone: "fail" };
      }
    } catch {
      next = { busy: false, text: "连不上邮局服务器", tone: "fail" };
    }
    setPings((p) => ({ ...p, [role]: next }));
    void refresh();
  }

  const chat = d.capabilities.find((c) => c.role === "chat");
  const total = d.summary.remote + d.summary.mock + d.summary.fallback;
  // 填了配置不等于连得上：要有过一次真实调用成功，或者刚测通，才算「正常」
  const chatVerified = d.recent.some((c) => c.role === "chat" && c.mode === "remote") || pings.chat?.tone === "ok";
  const overall = !chat?.configured
    ? { text: "演示模式（本地规则）", cls: "border-line bg-paper-2 text-ink-2" }
    : d.summary.fallback > 0
      ? { text: `最近有 ${d.summary.fallback} 次降级`, cls: "border-gold/40 bg-gold/10 text-gold" }
      : chatVerified
        ? { text: "真实模型 · 正常", cls: "border-post/40 bg-post-soft text-post" }
        : { text: "已配置 · 还没验证，点「测一下」", cls: "border-line bg-paper-2 text-ink-2" };

  return (
    <section className="card p-5" aria-labelledby="diag-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="diag-title" className="flex items-center gap-2 font-hand text-xl">
          <Activity size={18} className="text-stamp" /> 体检
        </h2>
        <div className="flex items-center gap-2">
          <span className={cn("rounded-full border px-2 py-0.5 text-xs", overall.cls)}>{overall.text}</span>
          <button onClick={refresh} disabled={loading} className="rounded-full p-1.5 text-ink-3 hover:bg-paper-2 hover:text-ink" aria-label="刷新体检">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-ink-3">
        {failed ? "刷新失败，下面是上一次的结果。" : `${checkedAt ? `${new Date(checkedAt).toLocaleTimeString("zh-CN", { hour12: false })} 更新 · ` : ""}每 10 秒自动刷新`}
      </p>

      {/* 每项能力的配置 */}
      <ul className="mt-4 divide-y divide-line rounded-xl border border-line">
        {d.capabilities.map((c) => {
          // 只有填了远程配置的对话和向量能测；没配置、本地 lite 向量没有可测的服务
          const testable = c.configured && (c.role === "chat" || c.role === "embed");
          return <CapabilityRow key={c.role} c={c} ping={testable ? pings[c.role as "chat" | "embed"] : undefined} onPing={testable ? () => ping(c.role as "chat" | "embed") : undefined} />;
        })}
      </ul>
      <p className="mt-2 text-[11px] leading-5 text-ink-3">
        「已配置」只说明填了地址和 Key，点「测一下」才会真的发一个很小的请求。配置在项目根目录的 <code>.env</code>，改完重启生效；Key 不会显示在这里。
      </p>

      {/* 最近的 AI 调用 */}
      <div className="mt-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-medium">最近 {total} 次 AI 调用</h3>
          {total > 0 && (
            <span className="text-xs text-ink-3">
              真实模型 {d.summary.remote} · 本地演示 {d.summary.mock} · <span className={d.summary.fallback ? "text-gold" : ""}>降级 {d.summary.fallback}</span>
            </span>
          )}
        </div>
        {total > 0 && (
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-paper-2" aria-hidden>
            <span className="bg-post" style={{ width: `${(d.summary.remote / total) * 100}%` }} />
            <span className="bg-ink-3/50" style={{ width: `${(d.summary.mock / total) * 100}%` }} />
            <span className="bg-gold" style={{ width: `${(d.summary.fallback / total) * 100}%` }} />
          </div>
        )}
        {d.recent.length === 0 ? (
          <p className="mt-3 text-xs text-ink-3">服务启动以来还没有 AI 调用。寄一篇日记或快进一下时光机再回来看。</p>
        ) : (
          <ol className="mt-3 max-h-72 space-y-1 overflow-y-auto pr-1">
            {d.recent.map((r, i) => (
              <li key={`${r.at}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg px-2 py-1 text-xs odd:bg-paper-2/60">
                {/* 服务端和浏览器时区可能不同，时间以浏览器为准 */}
                <span className="w-16 shrink-0 text-ink-3 tabular-nums" suppressHydrationWarning>
                  {new Date(r.at).toLocaleTimeString("zh-CN", { hour12: false })}
                </span>
                <span className="w-16 shrink-0">{r.purpose ? (PURPOSE[r.purpose] ?? r.purpose) : ROLE[r.role].label}</span>
                <ExecutionBadge info={r} />
              </li>
            ))}
          </ol>
        )}
        <p className="mt-2 text-[11px] text-ink-3">只记在内存里，服务重启后清空；不记录正文和提示词。</p>
      </div>

      {/* 数据库和虚拟时钟 */}
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-ink-2">
        <span className="flex items-center gap-1">
          <Database size={12} className={d.db.ok ? "text-post" : "text-stamp"} />
          {d.db.ok ? "数据库正常" : "数据库连不上"}
        </span>
        {d.db.ok && (
          <span>
            整理中的任务 {d.db.jobs.running} · <span className={d.db.jobs.failed ? "text-stamp" : ""}>失败的任务 {d.db.jobs.failed}</span>
          </span>
        )}
        <span>
          虚拟时间 {fmtCN(d.now, false)}
          {d.clockOffsetDays > 0.01 ? `（已快进 ${Math.round(d.clockOffsetDays)} 天）` : "（就是今天）"}
        </span>
      </div>
    </section>
  );
}

function CapabilityRow({ c, ping, onPing }: { c: AiCapability; ping?: PingState; onPing?: () => void }) {
  const lite = c.role === "embed" && c.model === "lite" && !c.configured;
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", c.configured ? "bg-post" : lite ? "bg-ink-3/60" : "bg-line")} aria-hidden />
      <span className="w-20 shrink-0 text-ink-2 sm:w-24">{ROLE[c.role].label}</span>
      <span className="min-w-0 flex-1">
        {c.configured ? (
          <>
            <span className="break-all">{c.model ?? "已配置"}</span>
            {c.host && <span className="ml-1.5 text-xs text-ink-3">@ {c.host}</span>}
            {c.role === "chat" && <span className="ml-1.5 text-xs text-ink-3">思考模式{c.thinking === "on" ? "开" : "关"}</span>}
          </>
        ) : lite ? (
          <span className="text-ink-3">本地向量（lite），不需要 Key</span>
        ) : (
          <span className="text-ink-3">未配置{c.role === "chat" ? "，使用本地规则演示" : c.role === "tts" ? "，朗读用浏览器自带的声音" : ""}</span>
        )}
      </span>
      {/* 手机上省掉配置名，给说明文字留宽度 */}
      <span className="hidden font-mono text-[11px] text-ink-3 sm:inline">{ROLE[c.role].env}</span>
      {onPing && (
        <span className="flex w-full items-center justify-end gap-2 sm:w-auto">
          {ping?.text && <span className={cn("text-xs", ping.tone === "ok" ? "text-post" : ping.tone === "fail" ? "text-stamp" : "text-ink-3")}>{ping.text}</span>}
          <button onClick={onPing} disabled={ping?.busy} className="btn btn-ghost !px-2.5 !py-0.5 text-xs">
            {ping?.busy ? <Loader2 size={12} className="animate-spin" /> : null}
            测一下
          </button>
        </span>
      )}
    </li>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Loader2, Reply, RotateCcw, X } from "lucide-react";
import { useToast } from "@/components/Toast";
import { STAGE_INFO } from "@/components/record/FinalizeProgress";
import { useFinalize } from "@/components/record/useFinalize";
import { cn } from "@/lib/utils";

interface ReplyResponse {
  replyEntryId: string;
  jobStatus: string;
  resolvedPlanIds: string[];
}

/**
 * 回信：寄出后回信会变成一条新记录，后端用「收进邮局」的同一套任务整理它。
 * 这里显示整理进度；失败只重试整理，不重发回信（重发会多出一条记录）。
 */
export function ReplyBox({ letterId, sender, triggerType, initialReply }: { letterId: string; sender: string; triggerType: string; initialReply: string | null }) {
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(initialReply);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ReplyResponse | null>(null);
  const toast = useToast();
  const fin = useFinalize(res?.replyEntryId ?? null);

  // 拿到回信记录 id 后订阅它的整理进度（任务已经在后台跑了，这里只是接上）
  useEffect(() => {
    if (res?.replyEntryId) void fin.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res?.replyEntryId]);

  async function send() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/letters/${letterId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reply", reply: text }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "回信没寄出去");
      setSent(text);
      setRes(data);
      toast("回信已寄出，邮差会把它也好好收起来", "✉️");
    } catch (e) {
      // 没寄出去就把字留在输入框里
      toast(e instanceof Error ? e.message : "回信没寄出去，请稍后再试", "⚠️");
    } finally {
      setBusy(false);
    }
  }

  const to = sender === "past_self" ? "过去的自己" : sender === "future_self" ? "未来的自己" : "邮差";

  if (!sent) {
    return (
      <div className="card mt-4 p-5">
        <div className="flex items-center gap-2 text-sm text-ink-2">
          <Reply size={14} /> 给{to}回一封信
        </div>
        <textarea className="input mt-3 min-h-[110px] font-hand text-lg" placeholder="回信也会成为你的一段记录" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <div className="mt-3 flex justify-end">
          <button className="btn btn-primary" disabled={busy || !draft.trim()} onClick={send}>
            {busy ? "正在寄出…" : "寄出回信"}
          </button>
        </div>
      </div>
    );
  }

  const memories = fin.result?.memories.length ?? 0;
  return (
    <div className="card mt-4 p-5">
      <div className="flex items-center gap-2 text-sm text-ink-3">
        <Reply size={14} /> 你的回信
      </div>
      <p className="mt-2 whitespace-pre-wrap font-hand text-lg leading-8">{sent}</p>

      {res && (
        <div className="mt-4 space-y-2 border-t border-line pt-3 text-xs text-ink-2">
          {triggerType === "open_loop" && (
            <p>{res.resolvedPlanIds.length ? "✅ 邮差知道这件事已经有结果了，之后不会再追问。" : "⏳ 邮差知道这件事还没结束，到时候可能还会来问你。"}</p>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-ink-3">
              {fin.phase === "completed" ? "回信已收进邮局" : fin.phase === "partial" ? "回信记住了，有一步没完成" : fin.phase === "failed" ? "回信已保存，但整理没完成" : "邮差正在把回信收进邮局"}
            </span>
            <ol className="flex items-center gap-1" aria-label="整理进度">
              {STAGE_INFO.map(({ key, label }) => {
                const st = fin.stages[key]?.status;
                return (
                  <li
                    key={key}
                    title={label}
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-full border",
                      (st === "completed" || st === "skipped") && "border-post bg-post text-card",
                      st === "failed" && "border-stamp bg-stamp text-card",
                      st === "started" && "border-post text-post",
                      !st && "border-line",
                    )}
                  >
                    {st === "completed" || st === "skipped" ? <Check size={10} strokeWidth={3} /> : st === "failed" ? <X size={10} strokeWidth={3} /> : st === "started" ? <Loader2 size={10} className="animate-spin" /> : null}
                  </li>
                );
              })}
            </ol>
            {fin.phase === "completed" && memories > 0 && <span>记住了 {memories} 件事</span>}
            {(fin.phase === "completed" || fin.phase === "partial") && (
              <Link href={`/entry/${res.replyEntryId}`} className="text-post hover:underline">
                看这条记录 →
              </Link>
            )}
            {(fin.phase === "failed" || fin.phase === "partial") && (
              <button onClick={() => fin.start()} className="inline-flex items-center gap-1 text-post hover:underline">
                <RotateCcw size={11} /> 重试整理
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

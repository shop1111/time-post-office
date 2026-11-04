"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./Toast";

/** 演示工具：回信立即送达 / 让小局现在写一封信 */
export function DemoTools({ instant }: { instant: boolean }) {
  const [on, setOn] = useState(instant);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function toggle() {
    const next = !on;
    setOn(next);
    const r = await fetch("/api/settings", { method: "PATCH", body: JSON.stringify({ instantReplies: next }) });
    if (!r.ok) {
      setOn(!next);
      return toast("保存失败", "⚠️");
    }
    toast(next ? "回信会立即送达（刷新页面就能收到）" : "回信恢复为几小时到一天后送达", "⏱️");
  }

  async function force() {
    setBusy(true);
    const r = await fetch("/api/postman", { method: "POST", body: JSON.stringify({ action: "force" }) }).then((r) => r.json());
    setBusy(false);
    const id = r.generated?.[0] ?? r.replies?.[0];
    if (id) {
      toast("小局写好了一封信", "📮");
      router.push(`/mail/${id}`);
    } else toast("小局翻了翻档案，暂时没有想写的信", "🤔");
    router.refresh();
  }

  return (
    <div className="mt-3 space-y-3">
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
        <span>
          <span className="block text-sm text-ink">回信立即送达</span>
          <span className="block text-xs text-ink-3">平时代笔回信会在几小时到一天后送达；打开后，寄出的信刷新页面就能收到回信。</span>
        </span>
        <input type="checkbox" className="h-5 w-5 accent-[var(--stamp)]" checked={on} onChange={toggle} />
      </label>
      <button className="btn btn-ghost text-sm" onClick={force} disabled={busy}>
        {busy ? "小局正在写信…" : "让小局现在写一封信"}
      </button>
    </div>
  );
}

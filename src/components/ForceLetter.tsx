"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useToast } from "./Toast";

/** 立即请小局巡检一次（忽略频控），方便演示 */
export function ForceLetter() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();
  async function run() {
    setBusy(true);
    const r = await fetch("/api/postman", { method: "POST", body: JSON.stringify({ action: "force" }) }).then((r) => r.json());
    setBusy(false);
    if (r.generated.length) {
      toast("小局写好了一封新信", "📮");
      router.push(`/mailbox/${r.generated[0]}`);
    } else toast("小局翻了翻档案，暂时没有想写的信（试试时光机快进）", "🤔");
    router.refresh();
  }
  return (
    <button className="btn btn-ghost text-sm" onClick={run} disabled={busy}>
      <Sparkles size={14} className={busy ? "animate-spin" : ""} /> {busy ? "小局正在写信…" : "请小局现在巡检"}
    </button>
  );
}

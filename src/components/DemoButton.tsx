"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./Toast";

export function DemoButton({ label = "载入示例人生", action = "load", className = "btn btn-ghost", confirmText }: { label?: string; action?: "load" | "clear"; className?: string; confirmText?: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();
  async function run() {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    try {
      await fetch("/api/demo", { method: "POST", body: JSON.stringify({ action }) });
      sessionStorage.removeItem("postman-pinged");
      toast(action === "load" ? "已载入林小满的半年时光" : "已清空所有数据", action === "load" ? "📦" : "🧹");
      // 整页刷新，让邮差重新巡检
      window.location.href = "/";
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return (
    <button className={className} onClick={run} disabled={busy}>
      {busy ? "小局正在搬运档案…" : label}
    </button>
  );
}

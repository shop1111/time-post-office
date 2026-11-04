"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./Toast";

/** 打开页面时让小局检查一次信箱：到期的信、代笔回信、小局的主动来信（受频控）。有新信就提示并刷新 */
export function CuratorPing() {
  const router = useRouter();
  const toast = useToast();
  useEffect(() => {
    // 每次打开页面都检查，但同一个标签页 2 分钟内只检查一次
    const last = Number(sessionStorage.getItem("curator-pinged") || 0);
    if (Date.now() - last < 120_000) return;
    sessionStorage.setItem("curator-pinged", String(Date.now()));
    fetch("/api/postman", { method: "POST", body: JSON.stringify({ action: "tick" }) })
      .then((r) => r.json())
      .then((r: { generated?: string[]; delivered?: string[]; replies?: string[] }) => {
        const replies = r.replies?.length ?? 0;
        const others = (r.generated?.length ?? 0) + (r.delivered?.length ?? 0);
        if (replies) toast(`收到了 ${replies} 封回信`, "💌");
        if (others) toast(`小局送来了 ${others} 封信`, "📮");
        if (replies || others) router.refresh();
      })
      .catch(() => {});
  }, [router, toast]);
  return null;
}

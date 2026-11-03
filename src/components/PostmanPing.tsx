"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./Toast";

/** 打开页面时让邮差巡检一次（受频控），有新信就提示并刷新 */
export function PostmanPing() {
  const router = useRouter();
  const toast = useToast();
  useEffect(() => {
    if (sessionStorage.getItem("postman-pinged")) return;
    sessionStorage.setItem("postman-pinged", "1");
    fetch("/api/postman", { method: "POST", body: JSON.stringify({ action: "tick" }) })
      .then((r) => r.json())
      .then((r: { generated: string[]; delivered: string[] }) => {
        const n = (r.generated?.length ?? 0) + (r.delivered?.length ?? 0);
        if (n > 0) {
          toast(`邮差刚刚送来了 ${n} 封信`, "📮");
          router.refresh();
        }
      })
      .catch(() => {});
  }, [router, toast]);
  return null;
}

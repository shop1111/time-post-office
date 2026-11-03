"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function RefreshProfile({ stale = false }: { stale?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  return (
    <div className="text-right"><button
      className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setError("");
        try {
          const response = await fetch("/api/profile", { method: "POST" });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "画像更新失败，请重试");
          router.refresh();
        } catch (error) {
          setError(error instanceof Error ? error.message : "连接失败，请重试");
        } finally {
          setBusy(false);
        }
      }}
    >
      <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> {busy ? "正在更新…" : stale ? "更新画像" : "重新认识我"}
    </button>{error && <p role="alert" className="mt-2 max-w-xs text-xs text-stamp">{error}</p>}</div>
  );
}

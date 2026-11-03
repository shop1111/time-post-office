"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function RefreshProfile() {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <button
      className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/profile", { method: "POST" });
        setBusy(false);
        router.refresh();
      }}
    >
      <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> 重新认识我
    </button>
  );
}

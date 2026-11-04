"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Trash2 } from "lucide-react";
import { useToast } from "./Toast";

export function EntryActions({ id, hasCard }: { id: string; hasCard: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();

  async function regen() {
    setBusy("card");
    await fetch(`/api/entries/${id}`, { method: "POST" });
    setBusy(null);
    toast("故事卡片重新写好了", "🖋️");
    router.refresh();
  }
  async function remove() {
    if (!confirm("删除后，这条记录和小局从中记住的事都会被忘掉。确定吗？")) return;
    setBusy("del");
    await fetch(`/api/entries/${id}`, { method: "DELETE" });
    router.push("/timeline");
    router.refresh();
  }
  return (
    <div className="flex flex-wrap gap-3 border-t border-line pt-6">
      <button className="btn btn-ghost" onClick={regen} disabled={!!busy}>
        <RefreshCw size={14} className={busy === "card" ? "animate-spin" : ""} /> {hasCard ? "重写故事卡片" : "生成故事卡片"}
      </button>
      <button className="btn btn-ghost !text-stamp" onClick={remove} disabled={!!busy}>
        <Trash2 size={14} /> 删除这条记录
      </button>
    </div>
  );
}

"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function CommunicationPreferences({ items }: { items: Array<{ id: string; entryId: string; kind: string; content: string; quote: string; status: string }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  return <details className="card p-5"><summary className="cursor-pointer font-hand text-xl">交流偏好与相处记录</summary>
    <p className="mt-3 text-xs leading-6 text-ink-3">明确表达的交流偏好会帮助小局调整说话方式；暂时的观察只作候选，不作为事实。你可以撤回，原始聊天保留。</p>
    {error && <p role="alert" className="mt-2 text-sm text-stamp">{error}</p>}
    {!items.length && <p className="mt-3 text-sm text-ink-3">暂时没有交流记录。</p>}
    <ul className="mt-3 space-y-3">{items.map((item) => <li className="rounded-xl border border-line p-3" key={item.id}>
      <div className="flex items-start justify-between gap-2"><p className="text-sm">{item.content}</p>
        {item.status !== "retracted" && <button disabled={!!busy} className="shrink-0 text-xs text-stamp" onClick={async () => {
          setBusy(item.id); setError("");
          try {
            const response = await fetch(`/api/memories/insights/${item.id}`, { method: "DELETE" });
            if (!response.ok) throw new Error("暂时未能撤回，请重试");
            router.refresh();
          } catch (error) { setError(error instanceof Error ? error.message : "连接失败，请重试"); }
          finally { setBusy(null); }
        }}>{busy === item.id ? "正在撤回…" : "撤回"}</button>}
      </div>
      <p className="mt-2 text-xs text-ink-3">{item.status === "retracted" ? "已撤回" : item.status === "expired" ? "来源已更正或撤回，暂停使用" : item.status === "active" ? "明确交流偏好" : "候选观察，暂不使用"} · <Link href={`/capsules/${item.entryId}`} className="underline">查看来源</Link></p>
      <blockquote className="mt-2 border-l border-line pl-2 text-xs text-ink-3">{item.quote}</blockquote>
    </li>)}</ul>
  </details>;
}

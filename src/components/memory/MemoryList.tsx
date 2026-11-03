"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { KIND_LABEL, type MemoryKind } from "@/lib/types";
import { cn, fmtCN } from "@/lib/utils";

interface Item {
  id: string;
  kind: string;
  content: string;
  importance: number;
  occurredAt: string;
  dueAt: string | null;
  resolved: boolean;
  entryId: string | null;
  recallCount: number;
  userEdited: boolean;
  entities: string[];
}

const KINDS = ["all", "event", "goal", "plan", "preference", "fact", "person", "place"] as const;

export function MemoryList({ items }: { items: Item[] }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const router = useRouter();
  const list = items.filter((i) => !hidden.has(i.id) && (kind === "all" || i.kind === kind));
  const counts = Object.fromEntries(KINDS.map((k) => [k, k === "all" ? items.length : items.filter((i) => i.kind === k).length]));

  async function save(id: string) {
    await fetch(`/api/memories/${id}`, { method: "PATCH", body: JSON.stringify({ content: draft }) });
    setEditing(null);
    router.refresh();
  }
  async function remove(id: string) {
    await fetch(`/api/memories/${id}`, { method: "DELETE" });
    setHidden((s) => new Set(s).add(id));
    router.refresh();
  }

  return (
    <div>
      <div className="scrollbar-none -mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {KINDS.filter((k) => counts[k] > 0).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={cn("chip shrink-0 !py-1", kind === k && "!bg-stamp !text-white")}>
            {k === "all" ? "全部" : KIND_LABEL[k as MemoryKind]} {counts[k]}
          </button>
        ))}
      </div>
      <ul className="space-y-2">
        {list.map((m) => (
          <li key={m.id} className="card flex items-start gap-3 px-4 py-3">
            <span className="mt-0.5 shrink-0 rounded bg-post-soft px-1.5 text-[11px] text-post">{KIND_LABEL[m.kind as MemoryKind] ?? m.kind}</span>
            <div className="min-w-0 flex-1">
              {editing === m.id ? (
                <div className="flex gap-2">
                  <input className="input !py-1.5 text-sm" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
                  <button onClick={() => save(m.id)} className="text-post" aria-label="保存">
                    <Check size={18} />
                  </button>
                  <button onClick={() => setEditing(null)} className="text-ink-3" aria-label="取消">
                    <X size={18} />
                  </button>
                </div>
              ) : (
                <p className="text-sm">{m.content}</p>
              )}
              <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-ink-3">
                {m.entryId ? <Link href={`/entry/${m.entryId}`} className="hover:underline">{fmtCN(m.occurredAt)}</Link> : <span>{fmtCN(m.occurredAt)}</span>}
                <span title="重要度">重要度 {m.importance}</span>
                {m.recallCount > 0 && <span>被想起 {m.recallCount} 次</span>}
                {m.dueAt && <span className={m.resolved ? "line-through" : "text-gold"}>⏰ {fmtCN(m.dueAt, false)}</span>}
                {m.userEdited && <span>✎ 你修改过</span>}
                {m.entities.map((e) => (
                  <span key={e}>#{e}</span>
                ))}
              </div>
            </div>
            {editing !== m.id && (
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => {
                    setEditing(m.id);
                    setDraft(m.content);
                  }}
                  className="rounded p-1 text-ink-3 hover:text-ink"
                  aria-label="修改"
                >
                  <Pencil size={14} />
                </button>
                <button onClick={() => remove(m.id)} className="rounded p-1 text-ink-3 hover:text-stamp" aria-label="忘掉">
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

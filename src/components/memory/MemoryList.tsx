"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Trash2, Check, X, Plus } from "lucide-react";
import { KIND_LABEL, type MemoryKind } from "@/lib/types";
import { cn, fmtCN } from "@/lib/utils";

interface EntityDraft { name: string; type: "person" | "place" | "theme" }
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
  status: string;
  revision: number;
  retractedAt: string | null;
  entities: EntityDraft[];
}

const KINDS = ["all", "event", "goal", "plan", "preference", "fact", "person", "place"] as const;

export function MemoryList({ items }: { items: Item[] }) {
  const [rows, setRows] = useState(items);
  const [kind, setKind] = useState<(typeof KINDS)[number]>("all");
  const [scope, setScope] = useState("active");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [importance, setImportance] = useState(5);
  const [entities, setEntities] = useState<EntityDraft[]>([]);
  const [expectedRevision, setExpectedRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const router = useRouter();
  useEffect(() => setRows(items), [items]);
  const scoped = rows.filter((m) => m.status === scope);
  const list = scoped.filter((m) => kind === "all" || m.kind === kind);

  function begin(memory: Item) {
    setEditing(memory.id);
    setDraft(memory.content);
    setImportance(memory.importance);
    setEntities(memory.entities.map((entity) => ({ ...entity })));
    setExpectedRevision(memory.revision);
    setError("");
    setMessage("");
  }

  async function mutate(memory: Item, method: "PATCH" | "DELETE") {
    if (busy) return;
    if (method === "DELETE" && !window.confirm("撤回后，这条记忆将停止用于长期记忆。原始日记和历史信件仍会保留。确认撤回？")) return;
    setBusy(memory.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/memories/${memory.id}`, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(method === "PATCH"
          ? { expectedRevision, content: draft, importance, entities }
          : { expectedRevision: memory.revision }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) router.refresh();
        throw new Error(result.error ?? "未能完成操作，请重试");
      }
      const updated: Item = {
        ...memory, ...result.memory,
        entities: result.memory.entities.map((link: { entity: EntityDraft }) => link.entity),
      };
      setRows((current) => current.map((row) => row.id === memory.id ? updated : row));
      setEditing(null);
      setMessage(method === "PATCH" ? "已更正。画像和月度回忆已失效，可按当前记忆重新生成。" : "已撤回，可在“已撤回”中查看记录。画像和月度回忆已失效。");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "网络连接失败，请重试。你的草稿已保留。");
    } finally {
      setBusy(null);
    }
  }

  return <div>
    <div className="mb-3 flex gap-2" role="group" aria-label="记忆状态筛选">
      {[["active", "有效记忆"], ["retracted", "已撤回"]].map(([value, label]) => <button
        key={value} className={cn("btn btn-ghost text-sm", scope === value && "!bg-stamp-soft !text-stamp")}
        aria-pressed={scope === value} disabled={!!busy || !!editing}
        onClick={() => { setScope(value); setKind("all"); setError(""); }}
      >{label} · {rows.filter((m) => m.status === value).length}</button>)}
    </div>
    <div className="scrollbar-none -mx-4 mb-4 flex gap-2 overflow-x-auto px-4" role="group" aria-label="记忆类型筛选">
      {KINDS.filter((k) => k === "all" || scoped.some((m) => m.kind === k)).map((k) => <button
        key={k} disabled={!!busy || !!editing} aria-pressed={kind === k}
        onClick={() => setKind(k)} className={cn("chip shrink-0 !py-1", kind === k && "!bg-stamp !text-white")}
      >{k === "all" ? "全部" : KIND_LABEL[k as MemoryKind]}</button>)}
    </div>
    {message && <p role="status" className="mb-4 rounded-xl bg-post-soft p-3 text-sm text-post">{message}</p>}
    {error && <p role="alert" className="mb-4 rounded-xl bg-stamp-soft p-3 text-sm text-stamp">{error}</p>}
    {scope === "retracted" && <p className="mb-3 text-xs leading-6 text-ink-3">这些记忆已停止使用，保留在这里供你核对。本期暂不提供恢复。</p>}
    {!list.length && <p className="card p-6 text-sm text-ink-3">{scope === "retracted" ? "还没有撤回过记忆。" : "这里还没有有效记忆。"}</p>}
    <ul className="space-y-3">
      {list.map((memory) => <li key={memory.id} className="card px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 rounded bg-post-soft px-1.5 text-[11px] text-post">{KIND_LABEL[memory.kind as MemoryKind] ?? memory.kind}</span>
          <div className="min-w-0 flex-1">
            {editing === memory.id ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void mutate(memory, "PATCH"); }}>
              <label className="block text-xs text-ink-2">记忆内容
                <textarea aria-label="记忆内容" className="input mt-1 min-h-24 w-full text-sm" value={draft} onChange={(event) => setDraft(event.target.value)} minLength={2} maxLength={160} required autoFocus disabled={!!busy} />
              </label>
              <label className="block text-xs text-ink-2">重要度（1–10）
                <input className="input ml-2 w-20 text-sm" type="number" min={1} max={10} step={1} required value={importance} onChange={(event) => setImportance(Number.isNaN(event.target.valueAsNumber) ? 0 : event.target.valueAsNumber)} disabled={!!busy} />
              </label>
              <fieldset className="space-y-2" disabled={!!busy}>
                <legend className="text-xs text-ink-2">关联人物、地点与主题</legend>
                <p className="text-xs text-ink-3">修改内容后，请一起确认关联。邮差不会擅自推断人物关系。</p>
                {entities.map((entity, index) => <div className="flex gap-2" key={index}>
                  <select className="input text-sm" aria-label={`关联 ${index + 1} 类型`} value={entity.type} onChange={(event) => setEntities((current) => current.map((e, i) => i === index ? { ...e, type: event.target.value as EntityDraft["type"] } : e))}>
                    <option value="person">人物</option><option value="place">地点</option><option value="theme">主题</option>
                  </select>
                  <input className="input min-w-0 flex-1 text-sm" aria-label={`关联 ${index + 1} 名称`} maxLength={20} required value={entity.name} onChange={(event) => setEntities((current) => current.map((e, i) => i === index ? { ...e, name: event.target.value } : e))} />
                  <button type="button" aria-label={`移除关联 ${index + 1}`} onClick={() => setEntities((current) => current.filter((_, i) => i !== index))}><X size={16} /></button>
                </div>)}
                <button type="button" className="btn btn-ghost text-xs" disabled={entities.length >= 20} onClick={() => setEntities((current) => [...current, { name: "", type: "person" }])}><Plus size={14} /> 添加关联</button>
              </fieldset>
              {memory.revision !== expectedRevision && <p className="text-xs text-stamp">这条记忆已有新版本，草稿仍保留。请复制需要保留的内容，取消后重新打开最新版本。</p>}
              <div className="flex gap-3">
                <button className="btn btn-primary text-sm" disabled={!!busy || memory.revision !== expectedRevision}><Check size={14} />{busy ? "正在保存…" : "保存更正"}</button>
                <button type="button" className="btn btn-ghost text-sm" disabled={!!busy} onClick={() => { setEditing(null); setError(""); }}><X size={14} />取消</button>
              </div>
            </form> : <p className="whitespace-pre-wrap break-words text-sm">{memory.content}</p>}
            <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-ink-3">
              {memory.entryId ? <Link href={`/entry/${memory.entryId}`} className="hover:underline">{fmtCN(memory.occurredAt)}</Link> : <span>{fmtCN(memory.occurredAt)}</span>}
              <span>重要度 {memory.importance}</span>
              {memory.status === "active" && memory.userEdited && <span className="text-post">已由你更正</span>}
              {memory.recallCount > 0 && <span>被想起 {memory.recallCount} 次</span>}
              {memory.dueAt && <span className={memory.resolved ? "line-through" : "text-gold"}>{fmtCN(memory.dueAt, false)}{memory.resolved ? " · 已完成" : " · 计划日期"}</span>}
              {memory.retractedAt && <span>撤回于 {fmtCN(memory.retractedAt)}</span>}
              {memory.entities.map((e) => <span key={`${e.type}:${e.name}`}>#{e.name}</span>)}
            </div>
          </div>
          {!editing && memory.status === "active" && <div className="flex shrink-0 gap-1">
            <button onClick={() => begin(memory)} disabled={!!busy} className="rounded p-1 text-ink-3 hover:text-ink" aria-label="更正记忆"><Pencil size={16} /></button>
            <button onClick={() => void mutate(memory, "DELETE")} disabled={!!busy} className="rounded p-1 text-ink-3 hover:text-stamp" aria-label="撤回记忆"><Trash2 size={16} /></button>
          </div>}
        </div>
      </li>)}
    </ul>
  </div>;
}

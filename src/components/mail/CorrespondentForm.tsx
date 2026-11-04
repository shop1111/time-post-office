"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/Toast";
import { cn } from "@/lib/utils";

const toDateInput = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** 新收件人：某个人 / 平行时空的自己。日期只能选过去 */
export function CorrespondentForm({ today, onCreated }: { today: string; onCreated?: (id: string) => void }) {
  const [kind, setKind] = useState<"person" | "parallel_self">("person");
  const [name, setName] = useState("");
  const [relation, setRelation] = useState("");
  const [moment, setMoment] = useState("");
  const [momentAt, setMomentAt] = useState("");
  const [voice, setVoice] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const max = toDateInput(new Date(today));
  const person = kind === "person";
  const ready = person ? !!name.trim() && !!moment.trim() : !!moment.trim() && !!momentAt;

  async function save() {
    setBusy(true);
    const r = await fetch("/api/correspondents", {
      method: "POST",
      body: JSON.stringify({ kind, name, relation, moment, momentAt: momentAt ? new Date(`${momentAt}T12:00:00`).toISOString() : undefined, voice }),
    });
    const data = await r.json();
    setBusy(false);
    if (!r.ok) return toast(data.error ?? "保存失败", "⚠️");
    toast(person ? `已添加收件人「${data.correspondent.name}」` : "已添加平行时空的自己", "📇");
    setName("");
    setRelation("");
    setMoment("");
    setMomentAt("");
    setVoice("");
    if (onCreated) onCreated(data.correspondent.id);
    else router.refresh();
  }

  return (
    <div className="card space-y-3 p-5">
      <div className="inline-flex rounded-full border border-line bg-paper p-1">
        {([
          ["person", "某个人"],
          ["parallel_self", "平行时空的自己"],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setKind(k)} className={cn("rounded-full px-4 py-1.5 text-sm transition", kind === k ? "bg-stamp text-white" : "text-ink-2")}>
            {label}
          </button>
        ))}
      </div>
      {person ? (
        <>
          <Field label="TA 叫什么">
            <input className="input" placeholder="例如：小明" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="TA 是谁，和你什么关系（可选）">
            <input className="input" placeholder="例如：大学隔壁宿舍的同学，后来没怎么联系" value={relation} onChange={(e) => setRelation(e.target.value)} />
          </Field>
          <Field label="你们之间的那个瞬间">
            <textarea className="input min-h-[80px]" placeholder="例如：那天下大雨，我没带伞，他把伞塞给我，自己淋着跑回去了" value={moment} onChange={(e) => setMoment(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="那是什么时候（可选）">
              <input type="date" className="input" max={max} value={momentAt} onChange={(e) => setMomentAt(e.target.value)} />
            </Field>
            <Field label="TA 说话的样子（可选）">
              <input className="input" placeholder="例如：话不多，爱开玩笑" value={voice} onChange={(e) => setVoice(e.target.value)} />
            </Field>
          </div>
        </>
      ) : (
        <>
          <Field label="分岔点：那是哪一天">
            <input type="date" className="input" max={max} value={momentAt} onChange={(e) => setMomentAt(e.target.value)} />
          </Field>
          <Field label="当时如果……">
            <textarea className="input min-h-[80px]" placeholder="例如：如果当时没有辞职来杭州，而是留在老家考了公务员" value={moment} onChange={(e) => setMoment(e.target.value)} />
          </Field>
          <Field label="怎么称呼 TA（可选）">
            <input className="input" placeholder="例如：留在老家的我" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </>
      )}
      <div className="flex justify-end">
        <button className="btn btn-primary" disabled={busy || !ready} onClick={save}>
          {busy ? "保存中…" : "添加收件人"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-ink-3">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}

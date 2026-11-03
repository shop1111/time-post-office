"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./Toast";

export function NameForm({ initial }: { initial: string }) {
  const [name, setName] = useState(initial);
  const router = useRouter();
  const toast = useToast();
  async function save() {
    await fetch("/api/profile", { method: "PATCH", body: JSON.stringify({ name }) });
    toast(`好的，以后叫你「${name}」`, "👋");
    router.refresh();
  }
  return (
    <div className="mt-3 flex gap-2">
      <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={12} />
      <button className="btn btn-primary" onClick={save} disabled={!name.trim() || name === initial}>
        保存
      </button>
    </div>
  );
}

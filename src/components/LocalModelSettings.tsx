"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Role, RoleConfig } from "@/lib/ai/local-settings";

type Overrides = Partial<Record<Role, Pick<RoleConfig, "baseUrl" | "model">>>;

const examples = {
  chat: { label: "对话 / 写信", baseUrl: "https://api.deepseek.com", model: "deepseek-flash" },
  vision: { label: "看图", baseUrl: "https://api.deepseek.com", model: "deepseek-flash" },
  embed: { label: "向量", baseUrl: "https://api.siliconflow.cn/v1", model: "BAAI/bge-m3" },
  asr: { label: "语音转写", baseUrl: "https://api.siliconflow.cn/v1", model: "FunAudioLLM/SenseVoiceSmall" },
} satisfies Record<Role, { label: string; baseUrl: string; model: string }>;

export function LocalModelSettings({ overrides }: { overrides: Overrides }) {
  const [role, setRole] = useState<Role>("chat");
  return (
    <details className="mt-4 border-t border-line pt-4">
      <summary className="cursor-pointer text-sm font-medium text-stamp">配置体验模型</summary>
      <p className="mt-2 text-xs leading-6 text-ink-3">
        保存后立即生效，相关内容会发送给所选模型服务。配置和密钥仅保存在本次服务运行期间，重启后恢复默认。
      </p>
      <label className="mt-3 block text-sm text-ink-2">
        能力
        <select className="input mt-1" value={role} onChange={(event) => setRole(event.target.value as Role)}>
          {Object.entries(examples).map(([id, { label }]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <ModelForm key={role} role={role} current={overrides[role]} />
    </details>
  );
}

function ModelForm({ role, current }: { role: Role; current?: Overrides[Role] }) {
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? examples[role].baseUrl);
  const [model, setModel] = useState(current?.model ?? examples[role].model);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function update(action: "save" | "reset") {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/settings/models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "save" ? { action, role, baseUrl, model, apiKey } : { action, role }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error ?? "模型配置未保存，请重试。");
      }
      setApiKey("");
      if (action === "reset") {
        setBaseUrl(examples[role].baseUrl);
        setModel(examples[role].model);
      }
      setMessage(action === "save" ? "已保存，可以在对应功能中试用。" : "已恢复默认配置。");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败，请重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-3 space-y-3" onSubmit={(event) => { event.preventDefault(); void update("save"); }}>
      <fieldset disabled={busy} className="space-y-3">
        <label className="block text-sm text-ink-2">
          接口地址（Base URL）
          <input type="url" required className="input mt-1" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
        </label>
        <label className="block text-sm text-ink-2">
          模型名称
          <input required className="input mt-1" value={model} onChange={(event) => setModel(event.target.value)} />
        </label>
        <label className="block text-sm text-ink-2">
          API 密钥
          <input type="password" required autoComplete="off" className="input mt-1" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-primary" disabled={!apiKey.trim()}>{busy ? "正在处理…" : "保存并启用"}</button>
          {current && <button type="button" className="btn btn-ghost" onClick={() => void update("reset")}>恢复默认</button>}
        </div>
      </fieldset>
      {message && <p className="text-sm text-post" role="status">{message}</p>}
      {error && <p className="text-sm text-stamp" role="alert">{error}</p>}
    </form>
  );
}

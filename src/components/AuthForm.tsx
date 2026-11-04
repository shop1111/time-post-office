"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Logo } from "./Nav";

/** 只允许跳回站内路径，防止 next 参数被用来跳到别的网站 */
function safeNext(next: string | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

interface Props {
  mode: "login" | "register";
  next?: string;
  inviteRequired?: boolean;
  registrationOpen?: boolean;
}

export function AuthForm({ mode, next, inviteRequired, registrationOpen }: Props) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const register = mode === "register";
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (register && password !== confirm) return setError("两次输入的密码不一样");
    setBusy(true);
    try {
      const res = await fetch(register ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, invite }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "出了点问题，请稍后再试");
        setBusy(false);
        return;
      }
      try { sessionStorage.clear(); } catch { /* 存储不可用时忽略 */ }
      // 整页跳转：不复用客户端缓存的页面
      window.location.href = safeNext(next);
    } catch {
      setError("网络好像断了，请稍后再试");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-[8vh] max-w-sm">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <Logo size={48} />
        <h1 className="font-hand text-3xl">时光邮局</h1>
        <p className="text-sm text-ink-3">{register ? "注册一个账号，小局会为你单独保管一个信箱" : "欢迎回来，小局一直在等你的信"}</p>
      </div>
      {register && !registrationOpen ? (
        <div className="card p-5 text-center text-sm text-ink-2">
          暂不开放注册。<Link href={`/login${nextQuery}`} className="text-stamp underline">去登录</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="card space-y-4 p-5">
          <label className="block text-sm">
            <span className="text-ink-2">用户名</span>
            <input className="input mt-1" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={32} />
            {register && <span className="mt-1 block text-xs text-ink-3">3~32 位字母、数字、下划线、点或短横线</span>}
          </label>
          <label className="block text-sm">
            <span className="text-ink-2">密码</span>
            <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 8 : 1} maxLength={128} />
            {register && <span className="mt-1 block text-xs text-ink-3">至少 8 位</span>}
          </label>
          {register && (
            <label className="block text-sm">
              <span className="text-ink-2">再输入一次密码</span>
              <input className="input mt-1" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required maxLength={128} />
            </label>
          )}
          {register && inviteRequired && (
            <label className="block text-sm">
              <span className="text-ink-2">邀请码</span>
              <input className="input mt-1" value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" required />
            </label>
          )}
          {error && <p className="text-sm text-stamp" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary w-full justify-center" disabled={busy}>
            {busy ? "请稍候…" : register ? "注册并进入" : "登录"}
          </button>
          <p className="text-center text-xs text-ink-3">
            {register ? (
              <>已经有账号了？<Link href={`/login${nextQuery}`} className="text-stamp underline">去登录</Link></>
            ) : registrationOpen ? (
              <>还没有账号？<Link href={`/register${nextQuery}`} className="text-stamp underline">注册一个</Link></>
            ) : null}
          </p>
        </form>
      )}
    </div>
  );
}

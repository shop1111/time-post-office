"use client";

import { useState } from "react";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    try { sessionStorage.clear(); } catch { /* 存储不可用时忽略 */ }
    window.location.href = "/login";
  }
  return (
    <button className="btn btn-ghost" onClick={logout} disabled={busy}>
      {busy ? "正在退出…" : "退出登录"}
    </button>
  );
}

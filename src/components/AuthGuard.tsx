"use client";

import { useEffect } from "react";

/** 登录过期时，任何 /api 请求返回 401 都直接带回登录页 */
export function AuthGuard() {
  useEffect(() => {
    const w = window as typeof window & { __tpoAuthGuard?: boolean };
    if (w.__tpoAuthGuard) return;
    w.__tpoAuthGuard = true;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await original(input, init);
      if (res.status === 401) {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const url = new URL(raw, window.location.href);
        if (url.origin === window.location.origin && url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/auth/")) {
          const next = window.location.pathname + window.location.search;
          window.location.href = `/login?next=${encodeURIComponent(next)}`;
        }
      }
      return res;
    };
  }, []);
  return null;
}

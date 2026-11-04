"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export const MEMORY_LOCATION_KEY = "memory.lastLocation";

export function MemoryNavigation() {
  const pathname = usePathname();
  useEffect(() => {
    const scrollKey = `memory.scroll:${pathname}`;
    let frame = 0;
    let secondFrame = 0;
    let restoring = true;
    try {
      sessionStorage.setItem(MEMORY_LOCATION_KEY, pathname);
      const saved = Number(sessionStorage.getItem(scrollKey) ?? 0);
      frame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          window.scrollTo(0, saved);
          restoring = false;
        });
      });
    } catch { restoring = false; }
    const save = () => {
      if (restoring || window.location.pathname !== pathname) return;
      try { sessionStorage.setItem(scrollKey, String(window.scrollY)); } catch { /* Storage may be disabled. */ }
    };
    window.addEventListener("scroll", save, { passive: true });
    return () => {
      save();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(secondFrame);
      window.removeEventListener("scroll", save);
    };
  }, [pathname]);
  return null;
}

"use client";

import Link from "next/link";
import type { ComponentProps } from "react";

/** A fresh visit from the map starts unfiltered; detail/back navigation keeps its state. */
export function CategoryLink({ category, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { category: string }) {
  return <Link {...props} href={`/memory/${category}`} onClick={() => {
    try {
      sessionStorage.removeItem(`memory.filters:${category}`);
      sessionStorage.removeItem(`memory.scroll:/memory/${category}`);
    } catch { /* Navigation works when storage is unavailable. */ }
  }} />;
}

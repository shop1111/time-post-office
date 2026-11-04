"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Package, Mail, Brain, Settings, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "主页", icon: Home },
  { href: "/capsules", label: "胶囊", icon: Package },
  { href: "/mail", label: "邮件", icon: Mail },
  { href: "/chat", label: "小局", icon: MessageCircle },
  { href: "/memory", label: "记忆", icon: Brain },
];

export function Nav({ unread, today }: { unread: number; today: string }) {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const d = new Date(today);
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line/70 bg-paper/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2">
            <Logo />
            <span className="font-hand text-xl font-bold tracking-wide">时光邮局</span>
          </Link>
          <nav className="ml-6 hidden items-center gap-1 md:flex">
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={cn(
                  "relative rounded-full px-3 py-1.5 text-sm transition",
                  active(t.href) ? "bg-card text-ink shadow-sm" : "text-ink-2 hover:text-ink",
                )}
              >
                {t.label}
                {t.href === "/mail" && unread > 0 && <Badge n={unread} />}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-full border border-line bg-card px-3 py-1 font-hand text-sm text-ink-2" title="今天">
              {d.getMonth() + 1}月{d.getDate()}日
            </span>
            <Link href="/settings" aria-label="设置" className={cn("rounded-full p-2 text-ink-2 hover:bg-card", active("/settings") && "bg-card")}>
              <Settings size={18} />
            </Link>
          </div>
        </div>
      </header>

      {/* 移动端底部 Tab */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = active(t.href);
            return (
              <Link key={t.href} href={t.href} className={cn("relative flex flex-col items-center gap-0.5 py-2 text-[11px]", on ? "text-stamp" : "text-ink-3")}>
                <Icon size={21} strokeWidth={on ? 2.2 : 1.7} />
                {t.label}
                {t.href === "/mail" && unread > 0 && <Badge n={unread} mobile />}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

function Badge({ n, mobile }: { n: number; mobile?: boolean }) {
  return (
    <span
      className={cn(
        "absolute flex h-4 min-w-4 items-center justify-center rounded-full bg-stamp px-1 text-[10px] font-bold text-white",
        mobile ? "right-[calc(50%-18px)] top-1" : "-right-1 -top-1",
      )}
    >
      {n}
    </span>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <rect x="3" y="7" width="34" height="26" rx="4" fill="var(--stamp)" />
      <path d="M3 11 L20 23 L37 11" stroke="var(--card)" strokeWidth="2.6" fill="none" strokeLinejoin="round" />
      <circle cx="31" cy="27" r="7" fill="var(--card)" stroke="var(--post)" strokeWidth="2" />
      <path d="M31 23.5 V27 L33.5 28.5" stroke="var(--post)" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { ToastProvider } from "@/components/Toast";
import { PostmanPing } from "@/components/PostmanPing";
import { db } from "@/lib/db";
import { now, getOffset } from "@/lib/clock";

export const metadata: Metadata = {
  title: "时光邮局 · 会记住你生活的 AI 伙伴",
  description: "用照片、语音和日记记录生活，AI 慢慢认识你，并在未来的某一天，以过去或未来的你的口吻给你写信。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5efe3" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1916" },
  ],
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [t, offset, unread] = await Promise.all([
    now(),
    getOffset(),
    db.letter.count({ where: { deliveredAt: { not: null }, readAt: null } }),
  ]);
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh">
        <ToastProvider>
          <Nav unread={unread} today={t.toISOString()} offsetDays={Math.round(offset / 86_400_000)} />
          <PostmanPing />
          <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-4 md:pb-16 md:pt-6">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}

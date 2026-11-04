import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { ToastProvider } from "@/components/Toast";
import { CuratorPing } from "@/components/CuratorPing";
import { AuthGuard } from "@/components/AuthGuard";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { getSessionUser } from "@/lib/auth";
import { runAsUser } from "@/lib/tenancy";

export const metadata: Metadata = {
  title: "时光邮局 · 小局陪你记住生活",
  description: "把生活放进胶囊，给想念的人、未来的自己、平行时空的自己写信。邮局局长小局会记住你的故事，时不时给你来信。",
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
  const user = await getSessionUser();
  // 未登录（登录 / 注册 / 关于页）：不显示导航，也不去检查信箱
  if (!user) {
    return (
      <html lang="zh-CN">
        <body className="min-h-dvh">
          <ToastProvider>
            <main className="mx-auto w-full max-w-5xl px-4 pb-16 pt-6">{children}</main>
          </ToastProvider>
        </body>
      </html>
    );
  }
  const [t, unread] = await runAsUser(user.id, () =>
    Promise.all([now(), db.letter.count({ where: { deliveredAt: { not: null }, readAt: null } })]),
  );
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh">
        <ToastProvider>
          <AuthGuard />
          <Nav unread={unread} today={t.toISOString()} />
          <CuratorPing />
          <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-4 md:pb-16 md:pt-6">{children}</main>
        </ToastProvider>
      </body>
    </html>
  );
}

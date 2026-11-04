import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getSessionUser, registrationOpen } from "@/lib/auth";

export const metadata: Metadata = { title: "登录 · 时光邮局" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const { next } = await searchParams;
  return <AuthForm mode="login" next={next} registrationOpen={registrationOpen()} />;
}

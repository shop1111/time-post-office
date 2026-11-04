import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { getSessionUser, inviteRequired, registrationOpen } from "@/lib/auth";

export const metadata: Metadata = { title: "注册 · 时光邮局" };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSessionUser()) redirect("/");
  const { next } = await searchParams;
  return <AuthForm mode="register" next={next} registrationOpen={registrationOpen()} inviteRequired={inviteRequired()} />;
}

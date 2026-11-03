import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { refreshProfile } from "@/lib/memory/profile";

export const runtime = "nodejs";

export async function PATCH(req: Request) {
  const { name } = (await req.json()) as { name?: string };
  if (name?.trim()) await db.profile.upsert({ where: { id: "me" }, update: { name: name.trim().slice(0, 12) }, create: { id: "me", name: name.trim().slice(0, 12) } });
  return NextResponse.json({ ok: true });
}

export async function POST() {
  await refreshProfile();
  return NextResponse.json({ ok: true });
}

import { withUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { refreshProfile } from "@/lib/memory/profile";
import { memoryErrorResponse } from "@/lib/memory/errors";

export const runtime = "nodejs";

async function handlePATCH(req: Request) {
  const { name } = (await req.json()) as { name?: string };
  if (name?.trim()) await db.profile.upsert({ where: { id: "me" }, update: { name: name.trim().slice(0, 12) }, create: { id: "me", name: name.trim().slice(0, 12) } });
  return NextResponse.json({ ok: true });
}

async function handlePOST() {
  try {
    const result = await refreshProfile();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

export const PATCH = withUser(handlePATCH);
export const POST = withUser(handlePOST);

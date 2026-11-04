import { withUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateStoryCard } from "@/lib/story";
import { deleteEntryJobs } from "@/lib/jobs";

export const runtime = "nodejs";

async function handleDELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.$transaction([deleteEntryJobs(id), db.entry.delete({ where: { id } })]);
  return NextResponse.json({ ok: true });
}

/** 重新生成故事卡片 */
async function handlePOST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await generateStoryCard(id);
  return NextResponse.json({ card });
}

export const DELETE = withUser(handleDELETE);
export const POST = withUser(handlePOST);

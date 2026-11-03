import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateStoryCard } from "@/lib/story";
import { deleteEntryJobs } from "@/lib/jobs";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.$transaction([deleteEntryJobs(id), db.entry.delete({ where: { id } })]);
  return NextResponse.json({ ok: true });
}

/** 重新生成故事卡片 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await generateStoryCard(id);
  return NextResponse.json({ card });
}

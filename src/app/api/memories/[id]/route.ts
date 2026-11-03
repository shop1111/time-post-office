import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { embed } from "@/lib/ai/provider";
import { toBytes } from "@/lib/memory/embed-lite";

export const runtime = "nodejs";

/** 用户纠正记忆：AI 记错了可以改，不想被记住可以删 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { content, importance } = (await req.json()) as { content?: string; importance?: number };
  const data: Record<string, unknown> = { userEdited: true };
  if (content?.trim()) {
    data.content = content.trim();
    data.embedding = toBytes((await embed([content.trim()]))[0]);
  }
  if (importance) data.importance = Math.max(1, Math.min(10, Math.round(importance)));
  const memory = await db.memory.update({ where: { id }, data });
  return NextResponse.json({ memory: { ...memory, embedding: undefined } });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.memory.delete({ where: { id } });
  // 清理孤立实体
  await db.entity.deleteMany({ where: { memories: { none: {} } } });
  return NextResponse.json({ ok: true });
}

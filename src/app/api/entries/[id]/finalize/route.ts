import { NextResponse } from "next/server";
import { processEntry } from "@/lib/memory/extract";
import { generateStoryCard } from "@/lib/story";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** 追问结束：抽取记忆 → 生成故事卡片 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { extraction, memories } = await processEntry(id);
  const card = await generateStoryCard(id);
  const entry = await db.entry.findUnique({ where: { id } });
  return NextResponse.json({
    extraction,
    entry,
    card,
    memories: memories.map((m) => ({ id: m.id, kind: m.kind, content: m.content, importance: m.importance, dueAt: m.dueAt, entities: m.entities.map((e) => ({ name: e.entity.name, type: e.entity.type })) })),
  });
}

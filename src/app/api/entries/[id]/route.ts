import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateStoryCard } from "@/lib/story";
import { deleteUpload } from "@/lib/files";
import { logError } from "@/lib/errors";
import { deleteEntryJobs } from "@/lib/jobs";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 任务检查点里有抽取结果和卡片内容，和记录在同一事务里删掉
  const [, entry] = await db.$transaction([deleteEntryJobs(id), db.entry.delete({ where: { id } })]);
  // 数据库删除成功后才动文件；清理失败不影响删除结果，也不阻止清理另一个文件。
  for (const name of new Set([entry.photoPath, entry.audioPath])) {
    try { await deleteUpload(name); }
    catch (error) { logError("entry.files", error); }
  }
  return NextResponse.json({ ok: true });
}

/** 重新生成故事卡片 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = await generateStoryCard(id);
  return NextResponse.json({ card });
}

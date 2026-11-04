import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generateStoryCard } from "@/lib/story";
import { deleteUpload } from "@/lib/files";
import { logError } from "@/lib/errors";
import { deleteEntryJobs } from "@/lib/jobs";
import { invalidateDerived } from "@/lib/memory/consistency";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let entry;
  try {
    entry = await db.$transaction(async (tx) => {
      const existing = await tx.entry.findUnique({ where: { id }, select: { memories: { select: { id: true } } } });
      if (!existing) return null;
      // 先读记忆ID；任务检查点、记录/级联记忆和派生数据必须一起删除或回滚。
      await deleteEntryJobs(id, tx);
      const removed = await tx.entry.delete({ where: { id } });
      await invalidateDerived({ entryId: id, memoryIds: existing.memories.map((memory) => memory.id), reason: "entry_deleted" }, tx);
      return removed;
    });
  } catch (error) {
    logError("entry.delete", error);
    return NextResponse.json({ error: "删除记录暂时失败，请稍后重试", code: "ENTRY_DELETE_FAILED", retryable: true } satisfies ApiError, { status: 500 });
  }
  if (!entry) return NextResponse.json({ error: "找不到这条记录", code: "ENTRY_NOT_FOUND", retryable: false } satisfies ApiError, { status: 404 });
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

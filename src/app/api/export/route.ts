import { db } from "@/lib/db";

export const runtime = "nodejs";

/** 数据完全属于用户：一键导出全部记录、记忆与信件 */
export async function GET() {
  const [profile, entries, memories, entities, letters, cards] = await Promise.all([
    db.profile.findMany(),
    db.entry.findMany({ include: { messages: true } }),
    db.memory.findMany({ select: { id: true, entryId: true, kind: true, content: true, importance: true, occurredAt: true, dueAt: true, resolved: true } }),
    db.entity.findMany(),
    db.letter.findMany(),
    db.storyCard.findMany(),
  ]);
  const body = JSON.stringify({ exportedAt: new Date(), profile, entries, memories, entities, letters, cards }, null, 2);
  return new Response(body, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="time-post-office-export.json"` },
  });
}

import { withUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/** 数据完全属于用户：一键导出全部胶囊、记忆、收件人与信件 */
async function handleGET() {
  const [profile, entries, memories, entities, correspondents, letters, cards] = await Promise.all([
    db.profile.findMany(),
    db.entry.findMany({ include: { messages: true } }),
    db.memory.findMany({ select: { id: true, entryId: true, kind: true, content: true, importance: true, occurredAt: true, dueAt: true, resolved: true, status: true, revision: true, retractedAt: true } }),
    db.entity.findMany(),
    db.correspondent.findMany(),
    db.letter.findMany(),
    db.storyCard.findMany(),
  ]);
  const body = JSON.stringify({ exportedAt: new Date(), profile, entries, memories, entities, correspondents, letters, cards }, null, 2);
  return new Response(body, {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="time-post-office-export.json"` },
  });
}

export const GET = withUser(handleGET);

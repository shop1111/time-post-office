import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { INSTANT_REPLIES_KEY } from "@/lib/correspondents";

export const runtime = "nodejs";

/** 演示工具：回信立即送达 */
export async function PATCH(req: Request) {
  const { instantReplies } = (await req.json().catch(() => ({}))) as { instantReplies?: boolean };
  if (typeof instantReplies !== "boolean") return NextResponse.json({ error: "参数不对" }, { status: 400 });
  const value = instantReplies ? "1" : "0";
  await db.setting.upsert({ where: { key: INSTANT_REPLIES_KEY }, update: { value }, create: { key: INSTANT_REPLIES_KEY, value } });
  if (instantReplies) {
    // 已经在路上的回信也一并提前
    await db.letter.updateMany({ where: { sender: "user", replyLetterId: null, replyDueAt: { gt: new Date() } }, data: { replyDueAt: new Date() } });
  }
  return NextResponse.json({ ok: true });
}

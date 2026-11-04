import { withUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { ensureSystemCorrespondents } from "@/lib/correspondents";
import { LetterError, sendLetter } from "@/lib/letters";

export const runtime = "nodejs";

/** 标记已读 / 回信。回信就是写给原寄信人的一封新信 */
async function handlePOST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action, reply } = (await req.json()) as { action: "read" | "reply"; reply?: string };
  if (action === "read") {
    const letter = await db.letter.update({ where: { id }, data: { readAt: await now() } });
    return NextResponse.json({ letter });
  }
  const original = await db.letter.findUnique({ where: { id } });
  if (!original) return NextResponse.json({ error: "找不到这封信" }, { status: 404 });
  // 旧数据没有收件人：当作写给小局
  const correspondentId = original.correspondentId ?? (await ensureSystemCorrespondents()).curator.id;
  try {
    const letter = await sendLetter({ correspondentId, body: reply, inReplyToId: original.id });
    return NextResponse.json({ letter });
  } catch (e) {
    if (e instanceof LetterError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export const POST = withUser(handlePOST);

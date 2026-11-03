import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";

export const runtime = "nodejs";

/** 写给未来的时间胶囊 */
export async function POST(req: Request) {
  const { subject, body, deliverAt } = (await req.json()) as { subject?: string; body?: string; deliverAt?: string };
  if (!body?.trim() || !deliverAt) return NextResponse.json({ error: "信的内容和送达日期都要填哦" }, { status: 400 });
  const t = await now();
  const when = new Date(deliverAt);
  if (when.getTime() <= t.getTime()) return NextResponse.json({ error: "送达日期要在未来" }, { status: 400 });
  const letter = await db.letter.create({
    data: {
      sender: "user",
      subject: subject?.trim() || "写给未来的我",
      body: body.trim(),
      triggerType: "capsule",
      reason: `这是你在 ${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日 写给未来自己的时间胶囊`,
      writtenAt: t,
      scheduledAt: when,
    },
  });
  return NextResponse.json({ letter });
}

import { NextResponse } from "next/server";
import { db, parseJson } from "@/lib/db";
import { now } from "@/lib/clock";
import { processEntry } from "@/lib/memory/extract";
import { SENDER_LABEL, type Sender } from "@/lib/types";

export const runtime = "nodejs";

/** 标记已读 / 回信。回信本身也会成为一条新记录，进入记忆闭环 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action, reply } = (await req.json()) as { action: "read" | "reply"; reply?: string };
  const t = await now();
  if (action === "read") {
    const letter = await db.letter.update({ where: { id }, data: { readAt: t } });
    return NextResponse.json({ letter });
  }
  if (!reply?.trim()) return NextResponse.json({ error: "回信内容不能为空" }, { status: 400 });
  const letter = await db.letter.update({ where: { id }, data: { reply: reply.trim(), repliedAt: t, readAt: t } });

  // 未完结线索被回答了 → 标记计划已解决
  const cited = parseJson<string[]>(letter.citedMemoryIds, []);
  if (letter.triggerType === "open_loop" && cited.length) {
    await db.memory.updateMany({ where: { id: { in: cited }, kind: "plan" }, data: { resolved: true } });
  }
  const entry = await db.entry.create({
    data: {
      type: "text",
      text: reply.trim(),
      occurredAt: t,
      title: `回信给${SENDER_LABEL[letter.sender as Sender] ?? "邮差"}`,
      messages: { create: [{ role: "assistant", content: `（来信《${letter.subject}》）${letter.body.slice(0, 200)}` }] },
    },
  });
  processEntry(entry.id).catch((e) => console.error("[reply] 记忆抽取失败", e));
  return NextResponse.json({ letter });
}

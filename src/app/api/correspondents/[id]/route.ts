import { withUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { assertPast, TimeRuleError } from "@/lib/time-rules";

export const runtime = "nodejs";

async function handlePATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await db.correspondent.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: "找不到这位收件人" }, { status: 404 });
  if (c.kind === "curator" || c.kind === "future_self") return NextResponse.json({ error: "固定收件人不能修改" }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { name?: string; relation?: string; moment?: string; momentAt?: string | null; voice?: string };
  const momentAt = b.momentAt === undefined ? undefined : b.momentAt ? new Date(b.momentAt) : null;
  try {
    assertPast(momentAt, await now(), "日期");
  } catch (e) {
    if (e instanceof TimeRuleError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const updated = await db.correspondent.update({
    where: { id },
    data: {
      ...(b.name?.trim() ? { name: b.name.trim().slice(0, 20) } : {}),
      ...(b.relation !== undefined ? { relation: b.relation.trim().slice(0, 200) } : {}),
      ...(b.moment?.trim() ? { moment: b.moment.trim().slice(0, 500) } : {}),
      ...(momentAt !== undefined && (c.kind !== "parallel_self" || momentAt) ? { momentAt } : {}),
      ...(b.voice !== undefined ? { voice: b.voice.trim().slice(0, 200) } : {}),
    },
  });
  return NextResponse.json({ correspondent: updated });
}

/** 删除收件人，连同和TA的往来信件 */
async function handleDELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await db.correspondent.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: "找不到这位收件人" }, { status: 404 });
  if (c.kind === "curator" || c.kind === "future_self") return NextResponse.json({ error: "固定收件人不能删除" }, { status: 400 });
  await db.correspondent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

export const PATCH = withUser(handlePATCH);
export const DELETE = withUser(handleDELETE);

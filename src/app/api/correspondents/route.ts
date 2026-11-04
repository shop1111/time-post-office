import { withUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { ensureSystemCorrespondents } from "@/lib/correspondents";
import { assertPast, TimeRuleError } from "@/lib/time-rules";

export const runtime = "nodejs";

async function handleGET() {
  await ensureSystemCorrespondents();
  const list = await db.correspondent.findMany({ orderBy: { createdAt: "asc" } });
  return NextResponse.json({ correspondents: list });
}

/** 新建收件人：某个人 / 平行时空的自己。小局和未来的我是固定的 */
async function handlePOST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { kind?: string; name?: string; relation?: string; moment?: string; momentAt?: string; voice?: string };
  const kind = b.kind === "parallel_self" ? "parallel_self" : b.kind === "person" ? "person" : null;
  if (!kind) return NextResponse.json({ error: "只能新建「某个人」或「平行时空的自己」" }, { status: 400 });
  const moment = b.moment?.trim() ?? "";
  const momentAt = b.momentAt ? new Date(b.momentAt) : null;
  if (kind === "person" && !b.name?.trim()) return NextResponse.json({ error: "写上TA的名字或称呼吧" }, { status: 400 });
  if (!moment) return NextResponse.json({ error: kind === "person" ? "说说你们之间的那个瞬间吧" : "说说那个分岔：当时如果选了什么" }, { status: 400 });
  if (kind === "parallel_self" && !momentAt) return NextResponse.json({ error: "选一个分岔点的日期" }, { status: 400 });
  try {
    assertPast(momentAt, await now(), kind === "person" ? "那个瞬间的日期" : "分岔点");
  } catch (e) {
    if (e instanceof TimeRuleError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  const c = await db.correspondent.create({
    data: {
      kind,
      name: kind === "person" ? b.name!.trim().slice(0, 20) : b.name?.trim().slice(0, 20) || "平行时空的我",
      relation: b.relation?.trim().slice(0, 200) ?? "",
      moment: moment.slice(0, 500),
      momentAt,
      voice: b.voice?.trim().slice(0, 200) ?? "",
    },
  });
  return NextResponse.json({ correspondent: c });
}

export const GET = withUser(handleGET);
export const POST = withUser(handlePOST);

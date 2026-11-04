import { db } from "@/lib/db";

/** Insight removal is deliberately soft; observed preferences are never irrevocable. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await db.xiaojuInsight.updateMany({ where: { id }, data: { status: "retracted" } });
  return result.count ? Response.json({ ok: true }) : Response.json({ error: "这条交流记录不存在" }, { status: 404 });
}

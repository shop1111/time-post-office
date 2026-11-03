import { NextResponse } from "next/server";
import { tick } from "@/lib/postman/engine";
import { fastForward, resetClock } from "@/lib/clock";

export const runtime = "nodejs";

/**
 * 邮差巡检 / 时光快进
 *  { action: "tick" }                常规巡检（页面打开时调用，受频控）
 *  { action: "forward", days: 90 }   时光快进 N 天并立即巡检
 *  { action: "reset" }               回到真实时间
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; days?: number };
  if (body.action === "forward") {
    const days = Math.max(1, Math.min(400, Number(body.days) || 30));
    await fastForward(days);
    const result = await tick({ maxLetters: days >= 60 ? 3 : 2, ignoreGap: true });
    return NextResponse.json(result);
  }
  if (body.action === "reset") {
    await resetClock();
    return NextResponse.json({ ok: true });
  }
  if (body.action === "force") return NextResponse.json(await tick({ maxLetters: 1, ignoreGap: true }));
  return NextResponse.json(await tick());
}

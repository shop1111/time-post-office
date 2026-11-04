import { withUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { tick } from "@/lib/postman/engine";

export const runtime = "nodejs";

/**
 * 小局检查信箱：投递到期的信和代笔回信，必要时主动写一封信
 *  { action: "tick" }   常规检查（页面打开时调用，主动来信受频控）
 *  { action: "force" }  设置页演示工具：忽略频控，让小局现在写一封信
 */
async function handlePOST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "force") return NextResponse.json(await tick({ maxLetters: 1, ignoreGap: true }));
  return NextResponse.json(await tick());
}

export const POST = withUser(handlePOST);

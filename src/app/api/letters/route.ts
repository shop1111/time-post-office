import { withUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { LetterError, sendLetter } from "@/lib/letters";

export const runtime = "nodejs";

/** 寄一封信 */
async function handlePOST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { correspondentId?: string; subject?: string; body?: string; inReplyToId?: string; deliverAt?: string };
  try {
    const letter = await sendLetter(b);
    return NextResponse.json({ letter });
  } catch (e) {
    if (e instanceof LetterError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export const POST = withUser(handlePOST);

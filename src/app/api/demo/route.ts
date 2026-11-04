import { withUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { clearAll, loadDemo } from "@/lib/demo/seed";

export const runtime = "nodejs";

async function handlePOST(req: Request) {
  const { action } = (await req.json()) as { action: "load" | "clear" };
  if (action === "clear") {
    await clearAll();
    return NextResponse.json({ ok: true });
  }
  const r = await loadDemo();
  return NextResponse.json({ ok: true, ...r });
}

export const POST = withUser(handlePOST);

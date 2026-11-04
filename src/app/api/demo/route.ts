import { NextResponse } from "next/server";
import { clearAll, loadDemo } from "@/lib/demo/seed";
import { withAiPurpose } from "@/lib/ai/telemetry";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { action } = (await req.json()) as { action: "load" | "clear" };
  if (action === "clear") {
    await clearAll();
    return NextResponse.json({ ok: true });
  }
  const r = await withAiPurpose("demo", () => loadDemo());
  return NextResponse.json({ ok: true, ...r });
}

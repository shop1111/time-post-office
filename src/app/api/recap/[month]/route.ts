import { NextResponse } from "next/server";
import { buildRecap } from "@/lib/story";
import { withAiPurpose } from "@/lib/ai/telemetry";

export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: "bad month" }, { status: 400 });
  const recap = await withAiPurpose("recap", () => buildRecap(month, true));
  return NextResponse.json({ recap });
}

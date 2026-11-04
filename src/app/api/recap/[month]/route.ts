import { withUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { buildRecap } from "@/lib/story";
import { memoryErrorResponse } from "@/lib/memory/errors";

export const runtime = "nodejs";

async function handlePOST(_req: Request, { params }: { params: Promise<{ month: string }> }) {
  const { month } = await params;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "月份格式有误" }, { status: 400 });
  try {
    const recap = await buildRecap(month, true);
    return NextResponse.json({ recap });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

export const POST = withUser(handlePOST);

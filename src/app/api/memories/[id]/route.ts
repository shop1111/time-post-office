import { NextResponse } from "next/server";
import { correctMemory, retractMemory } from "@/lib/memory/manage";
import { memoryErrorResponse } from "@/lib/memory/errors";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await correctMemory(id, await req.json());
    return NextResponse.json({ ...result, memory: { ...result.memory, embedding: undefined } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.text();
    const result = await retractMemory(id, body.trim() ? JSON.parse(body) : {});
    return NextResponse.json({ ok: true, ...result, memory: { ...result.memory, embedding: undefined } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

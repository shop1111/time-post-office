import { withUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { correctMemory, retractMemory } from "@/lib/memory/manage";
import { memoryErrorResponse } from "@/lib/memory/errors";

export const runtime = "nodejs";

async function handlePATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const result = await correctMemory(id, await req.json());
    return NextResponse.json({ ...result, memory: { ...result.memory, embedding: undefined } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

async function handleDELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.text();
    const result = await retractMemory(id, body.trim() ? JSON.parse(body) : {});
    return NextResponse.json({ ok: true, ...result, memory: { ...result.memory, embedding: undefined } });
  } catch (error) {
    return memoryErrorResponse(error);
  }
}

export const PATCH = withUser(handlePATCH);
export const DELETE = withUser(handleDELETE);

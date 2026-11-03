import { NextResponse } from "next/server";
import { z } from "zod";
import { DerivedDataConflictError } from "./consistency";
import { MemoryManagementError } from "./manage";

/** Return actionable errors without leaking model credentials or database details. */
export function memoryErrorResponse(error: unknown) {
  if (error instanceof z.ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "输入内容有误" }, { status: 400 });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "请求内容格式有误" }, { status: 400 });
  if (error instanceof MemoryManagementError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof DerivedDataConflictError) return NextResponse.json({ error: error.message }, { status: 409 });
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "P2034" || code === "P2028" || code === "P1008") {
    return NextResponse.json({ error: "记忆正在被更新，请稍后重试，你的输入不会丢失" }, { status: 409 });
  }
  console.error("[memory] 操作失败", error instanceof Error ? error.name : "unknown");
  return NextResponse.json({ error: "暂时未能完成操作，请重试" }, { status: 500 });
}

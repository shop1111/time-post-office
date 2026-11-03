import { NextResponse } from "next/server";
import { transcribe } from "@/lib/ai/provider";

export const runtime = "nodejs";

/** 服务端语音转写（配置了 ASR 时可用；否则前端使用 Web Speech API） */
export async function POST(req: Request) {
  const form = await req.formData();
  const audio = form.get("audio") as File | null;
  if (!audio) return NextResponse.json({ error: "no audio" }, { status: 400 });
  const text = await transcribe(audio, audio.name || "voice.webm");
  return NextResponse.json({ text });
}

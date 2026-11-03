import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { saveUpload } from "@/lib/files";
import { describeImage, transcribe } from "@/lib/ai/provider";
import { reverseGeocode } from "@/lib/geo";
import { now } from "@/lib/clock";

export const runtime = "nodejs";

/** 新建记录：照片 / 语音 / 日记（multipart） */
export async function POST(req: Request) {
  const form = await req.formData();
  const type = String(form.get("type") ?? "text");
  const text = String(form.get("text") ?? "").trim();
  let transcript = String(form.get("transcript") ?? "").trim() || null;
  const photo = form.get("photo") as File | null;
  const audio = form.get("audio") as File | null;
  const lat = form.get("lat") ? Number(form.get("lat")) : null;
  const lng = form.get("lng") ? Number(form.get("lng")) : null;
  const exifTime = form.get("exifTime") ? new Date(String(form.get("exifTime"))) : null;
  const occurredAtRaw = form.get("occurredAt") ? new Date(String(form.get("occurredAt"))) : null;
  let place = String(form.get("place") ?? "").trim() || null;

  if (!text && !photo && !audio && !transcript) return NextResponse.json({ error: "空空的信封寄不出去哦" }, { status: 400 });

  let photoPath: string | null = null;
  let visionCaption: string | null = null;
  if (photo && photo.size) {
    photoPath = await saveUpload(photo, "photo");
    const b64 = Buffer.from(await photo.arrayBuffer()).toString("base64");
    visionCaption = await describeImage(`data:${photo.type || "image/jpeg"};base64,${b64}`, text);
  }
  if (audio && audio.size) {
    await saveUpload(audio, "voice");
    if (!transcript) transcript = await transcribe(audio, audio.name || "voice.webm");
  }
  if (!place && lat !== null && lng !== null) place = reverseGeocode(lat, lng);

  const entry = await db.entry.create({
    data: {
      type,
      text: text || transcript || "",
      transcript,
      photoPath,
      visionCaption,
      exifTime,
      lat,
      lng,
      place,
      occurredAt: occurredAtRaw ?? exifTime ?? (await now()),
    },
  });
  return NextResponse.json({ entry });
}

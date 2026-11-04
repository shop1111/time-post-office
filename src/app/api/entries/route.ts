import { withUser } from "@/lib/auth";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { saveUpload } from "@/lib/files";
import { describeImage, transcribe } from "@/lib/ai/provider";
import { reverseGeocode } from "@/lib/geo";
import { now } from "@/lib/clock";
import { assertPast, clampToNow, TimeRuleError } from "@/lib/time-rules";

export const runtime = "nodejs";

/** 放一颗胶囊：照片 / 语音 / 文字（multipart）。时间只能是已经发生的 */
async function handlePOST(req: Request) {
  const form = await req.formData();
  const type = String(form.get("type") ?? "text");
  const text = String(form.get("text") ?? "").trim();
  let transcript = String(form.get("transcript") ?? "").trim() || null;
  const photo = form.get("photo") as File | null;
  const audio = form.get("audio") as File | null;
  const lat = form.get("lat") ? Number(form.get("lat")) : null;
  const lng = form.get("lng") ? Number(form.get("lng")) : null;
  const t = await now();
  // 相机时钟可能不准：晚于现在的 EXIF 时间截断到现在
  const exifRaw = form.get("exifTime") ? new Date(String(form.get("exifTime"))) : null;
  const exifTime = exifRaw && !Number.isNaN(exifRaw.getTime()) ? clampToNow(exifRaw, t) : null;
  const occurredAtRaw = form.get("occurredAt") ? new Date(String(form.get("occurredAt"))) : null;
  try {
    assertPast(occurredAtRaw, t, "胶囊的时间");
  } catch (e) {
    if (e instanceof TimeRuleError) return NextResponse.json({ error: e.message }, { status: 400 });
    throw e;
  }
  let place = String(form.get("place") ?? "").trim() || null;

  if (!text && !photo && !audio && !transcript) return NextResponse.json({ error: "空空的胶囊放不进去哦" }, { status: 400 });

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
      occurredAt: occurredAtRaw ?? exifTime ?? t,
    },
  });
  return NextResponse.json({ entry });
}

export const POST = withUser(handlePOST);

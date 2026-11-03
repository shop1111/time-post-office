"use client";

import { useRef, useState } from "react";
import { ImagePlus, MapPin, CalendarClock, X } from "lucide-react";
import { reverseGeocode } from "@/lib/geo";
import { cn } from "@/lib/utils";

export interface PhotoInfo {
  file: File;
  preview: string;
  exifTime: Date | null;
  lat: number | null;
  lng: number | null;
  place: string | null;
}

/** 前端压缩：长边 ≤ 1600px，JPEG 0.85。原图 EXIF 先读出来再压缩 */
async function compress(file: File): Promise<File> {
  if (file.size < 600_000 || !file.type.startsWith("image/")) return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.85));
  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
}

export function PhotoPicker({ value, onChange }: { value: PhotoInfo | null; onChange: (p: PhotoInfo | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handle(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      let exifTime: Date | null = null;
      let lat: number | null = null;
      let lng: number | null = null;
      try {
        const exifr = (await import("exifr")).default;
        const meta = await exifr.parse(file, { gps: true, pick: ["DateTimeOriginal", "CreateDate", "latitude", "longitude"] });
        exifTime = meta?.DateTimeOriginal ?? meta?.CreateDate ?? null;
        lat = typeof meta?.latitude === "number" ? meta.latitude : null;
        lng = typeof meta?.longitude === "number" ? meta.longitude : null;
      } catch {
        /* 没有 EXIF 也没关系 */
      }
      const small = await compress(file);
      onChange({ file: small, preview: URL.createObjectURL(small), exifTime, lat, lng, place: lat !== null && lng !== null ? reverseGeocode(lat, lng) : null });
    } finally {
      setBusy(false);
    }
  }

  if (value) {
    return (
      <div className="card relative overflow-hidden p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value.preview} alt="预览" className="max-h-[360px] w-full rounded-lg object-cover" />
        <button onClick={() => onChange(null)} className="absolute right-4 top-4 rounded-full bg-black/50 p-1.5 text-white" aria-label="移除照片">
          <X size={16} />
        </button>
        <div className="flex flex-wrap gap-2 px-1 pt-2">
          {value.exifTime && (
            <span className="chip">
              <CalendarClock size={12} /> 拍摄于 {value.exifTime.toLocaleString("zh-CN", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {value.lat !== null && (
            <span className="chip">
              <MapPin size={12} /> {value.place ?? `${value.lat.toFixed(2)}, ${value.lng?.toFixed(2)}`}（GPS）
            </span>
          )}
          {!value.exifTime && value.lat === null && <span className="chip">照片里没有 EXIF 信息，可以在下面补充时间地点</span>}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handle(e.dataTransfer.files[0]);
      }}
      className={cn(
        "flex h-56 w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line bg-card text-ink-2 transition hover:border-stamp/60",
        drag && "border-stamp bg-stamp-soft",
      )}
    >
      <ImagePlus size={36} className="text-stamp" />
      <span className="text-sm">{busy ? "正在读取照片…" : "点击或拖拽一张照片到这里"}</span>
      <span className="text-xs text-ink-3">会自动读取拍摄时间和地点</span>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
    </button>
  );
}

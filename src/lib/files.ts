import { mkdir, writeFile, open } from "fs/promises";
import path from "path";
import crypto from "crypto";

export const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

export async function saveUpload(file: File, prefix: string): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? guessExt(file.type)).toLowerCase();
  const name = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  await writeFile(path.join(UPLOAD_DIR, name), Buffer.from(await file.arrayBuffer()));
  return name;
}

/** 同时处理Windows和POSIX分隔符；拒绝盘符、流名称及特殊路径。 */
export function uploadName(name: string) {
  const safe = path.posix.basename(path.win32.basename(name));
  if (!safe || safe === "." || safe === ".." || /[:\0]/.test(safe)) throw new Error("Invalid upload name");
  return safe;
}

export async function openUpload(name: string) {
  const file = await open(path.join(UPLOAD_DIR, uploadName(name)), "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new Error("Upload is not a file");
    return { file, size: stat.size };
  } catch (error) { await file.close(); throw error; }
}

/** 仅支持单段bytes；不满足或格式无效返回null，由路由统一416。 */
export function byteRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || !size || (!match[1] && !match[2])) return null;
  const first = Number(match[1]), last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null;
  if (!match[1]) return last > 0 ? { start: Math.max(0, size - last), end: size - 1 } : null;
  const end = match[2] ? Math.min(last, size - 1) : size - 1;
  return first < size && end >= first ? { start: first, end } : null;
}

export function mimeOf(name: string) {
  const ext = path.extname(name).toLowerCase();
  return (
    { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif", ".webm": "audio/webm", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav" } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}

function guessExt(type: string) {
  if (type.includes("jpeg")) return ".jpg";
  if (type.includes("png")) return ".png";
  if (type.includes("webp")) return ".webp";
  if (type.includes("webm")) return ".webm";
  if (type.includes("ogg")) return ".ogg";
  if (type.includes("mp4")) return ".m4a";
  if (type.includes("wav")) return ".wav";
  if (type.includes("mpeg") || type.includes("mp3")) return ".mp3";
  return ".bin";
}

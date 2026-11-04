import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";
import crypto from "crypto";
import { currentUserId } from "./db";
import { userUploadDir } from "./tenancy";

/** 每个用户的上传文件放在自己的目录里（data/users/<userId>/uploads） */
const uploadDir = () => userUploadDir(currentUserId());

export async function saveUpload(file: File, prefix: string): Promise<string> {
  const dir = uploadDir();
  await mkdir(dir, { recursive: true });
  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? guessExt(file.type)).toLowerCase();
  const name = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
  await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  return name;
}

export async function readUpload(name: string) {
  const safe = path.basename(name);
  return readFile(path.join(uploadDir(), safe));
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
  return ".bin";
}

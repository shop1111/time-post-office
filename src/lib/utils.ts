/** 前后端通用的小工具（不得引入 node 模块） */
import clsx, { type ClassValue } from "clsx";

export const cn = (...c: ClassValue[]) => clsx(c);

/** 照片地址：上传的走 /api/files，示例数据里的 SVG 插画放在 public/demo */
export function photoUrl(p: string | null | undefined) {
  if (!p) return null;
  return p.startsWith("/") ? p : `/api/files/${p}`;
}

export function fmtCN(d: Date | string, withYear = true) {
  const x = new Date(d);
  return `${withYear ? `${x.getFullYear()}年` : ""}${x.getMonth() + 1}月${x.getDate()}日`;
}

export function fmtTime(d: Date | string) {
  const x = new Date(d);
  return `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
}

export function monthKey(d: Date | string) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`;
}

export function daysBetween(a: Date | string, b: Date | string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);
}

export function moodColor(m: number | null | undefined) {
  if (m === null || m === undefined) return "var(--ink-3)";
  if (m > 0.35) return "#e8a33d";
  if (m > 0.05) return "#c9a15a";
  if (m > -0.2) return "#8a9aa8";
  return "#6b7ea8";
}

export function moodEmoji(m: number | null | undefined) {
  if (m === null || m === undefined) return "·";
  if (m > 0.5) return "☀️";
  if (m > 0.15) return "🌤";
  if (m > -0.15) return "☁️";
  if (m > -0.5) return "🌧";
  return "⛈";
}

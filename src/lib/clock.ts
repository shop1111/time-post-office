import { db } from "./db";

/**
 * 虚拟时钟：演示时可「时光快进」，所有业务逻辑都通过 now() 取当前时间。
 * 偏移量（毫秒）持久化在 Setting 表。
 */
const KEY = "clockOffsetMs";
export const MS_DAY = 86_400_000;

export async function getOffset(): Promise<number> {
  const row = await db.setting.findUnique({ where: { key: KEY } });
  return row ? Number(row.value) || 0 : 0;
}

export async function now(): Promise<Date> {
  return new Date(Date.now() + (await getOffset()));
}

export async function fastForward(days: number): Promise<Date> {
  const offset = (await getOffset()) + days * MS_DAY;
  await db.setting.upsert({ where: { key: KEY }, update: { value: String(offset) }, create: { key: KEY, value: String(offset) } });
  return new Date(Date.now() + offset);
}

export async function resetClock() {
  await db.setting.deleteMany({ where: { key: KEY } });
}

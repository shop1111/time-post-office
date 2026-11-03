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
  if (!Number.isFinite(days)) throw new Error("Clock days must be finite");
  const delta = days * MS_DAY;
  // Setting.value 是字符串：用一条带参数的 SQLite UPSERT 完成自增和返回，避免读后写丢增量。
  const [row] = await db.$queryRaw<Array<{ value: string }>>`
    INSERT INTO "Setting" ("key", "value") VALUES (${KEY}, ${String(delta)})
    ON CONFLICT("key") DO UPDATE SET "value" = CAST(CAST("Setting"."value" AS REAL) + ${delta} AS TEXT)
    RETURNING "value"
  `;
  return new Date(Date.now() + Number(row.value));
}

export async function resetClock() {
  await db.setting.deleteMany({ where: { key: KEY } });
}

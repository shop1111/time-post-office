import { db } from "./db";

/**
 * 时钟：一律使用真实的今天。所有业务逻辑都通过 now() 取当前时间，便于测试替换。
 */
export const MS_DAY = 86_400_000;

// 旧版「时光机」留下的虚拟时间偏移，第一次取时间时顺手清掉
let legacyCleaned = false;

export async function now(): Promise<Date> {
  if (!legacyCleaned) {
    legacyCleaned = true;
    await db.setting.deleteMany({ where: { key: "clockOffsetMs" } }).catch(() => {});
  }
  return new Date();
}

/**
 * 时钟：一律使用真实的今天。所有业务逻辑都通过 now() 取当前时间，便于测试替换。
 */
export const MS_DAY = 86_400_000;

export async function now(): Promise<Date> {
  return new Date();
}

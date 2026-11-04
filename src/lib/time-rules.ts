/** 时间规则：胶囊、那个瞬间、分岔点只能是已经发生的时间；写给未来的信只能送往未来 */
const TOLERANCE_MS = 5 * 60_000; // 容忍前后端时钟误差

export class TimeRuleError extends Error {
  readonly status = 400;
}

export function isPast(d: Date, now: Date) {
  return d.getTime() <= now.getTime() + TOLERANCE_MS;
}

export function assertPast(d: Date | null | undefined, now: Date, what = "时间") {
  if (!d) return;
  if (Number.isNaN(d.getTime())) throw new TimeRuleError(`${what}格式不对`);
  if (!isPast(d, now)) throw new TimeRuleError(`${what}只能选择已经发生的时间`);
}

export function assertFuture(d: Date | null | undefined, now: Date, what = "送达日期") {
  if (!d || Number.isNaN(d.getTime())) throw new TimeRuleError(`请选择${what}`);
  if (d.getTime() <= now.getTime()) throw new TimeRuleError(`${what}要在未来`);
}

/** 晚于现在的时间截断到现在（例如相机时钟不准的 EXIF） */
export function clampToNow(d: Date, now: Date) {
  return d.getTime() > now.getTime() ? now : d;
}

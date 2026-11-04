import { describe, expect, it } from "vitest";
import { assertFuture, assertPast, clampToNow, TimeRuleError } from "@/lib/time-rules";

const NOW = new Date("2026-11-04T12:00:00");
const plus = (ms: number) => new Date(NOW.getTime() + ms);

describe("时间规则", () => {
  it("胶囊 / 那个瞬间 / 分岔点：过去和现在可以，未来不行", () => {
    expect(() => assertPast(plus(-86_400_000), NOW)).not.toThrow();
    expect(() => assertPast(NOW, NOW)).not.toThrow();
    // 容忍几分钟的前后端时钟误差
    expect(() => assertPast(plus(60_000), NOW)).not.toThrow();
    expect(() => assertPast(plus(3_600_000), NOW)).toThrow(TimeRuleError);
    expect(() => assertPast(null, NOW)).not.toThrow();
    expect(() => assertPast(new Date("坏日期"), NOW)).toThrow(TimeRuleError);
  });

  it("写给未来自己的信：送达日必须在未来", () => {
    expect(() => assertFuture(plus(86_400_000), NOW)).not.toThrow();
    expect(() => assertFuture(NOW, NOW)).toThrow(TimeRuleError);
    expect(() => assertFuture(plus(-1), NOW)).toThrow(TimeRuleError);
    expect(() => assertFuture(null, NOW)).toThrow(TimeRuleError);
  });

  it("晚于现在的 EXIF 时间截断到现在", () => {
    expect(clampToNow(plus(86_400_000), NOW)).toBe(NOW);
    expect(clampToNow(plus(-1000), NOW).getTime()).toBe(NOW.getTime() - 1000);
  });
});

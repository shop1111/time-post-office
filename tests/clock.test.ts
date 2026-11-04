import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { testDatabase } from "./helpers/database";
import { fastForward, getOffset, MS_DAY, resetClock } from "@/lib/clock";
const f = vi.hoisted(() => ({ fixture: undefined as unknown as ReturnType<typeof testDatabase> }));
vi.mock("@/lib/db", async () => {
  const { testDatabase } = await import("./helpers/database");
  f.fixture = testDatabase("clock");
  return { db: f.fixture.db };
});
beforeAll(() => f.fixture.setup(), 120_000);
beforeEach(() => resetClock());
afterAll(() => f.fixture.cleanup());
it("并发自增包括首次创建，不丢天数", async () => {
  await Promise.all(Array.from({ length: 20 }, (_, i) => fastForward(i % 2 ? 1 : 2)));
  expect(await getOffset()).toBe(30 * MS_DAY);
});
it("兼容已有字符串偏移、小数天和reset", async () => {
  await f.fixture.db.setting.create({ data: { key: "clockOffsetMs", value: String(3 * MS_DAY) } });
  const now = await fastForward(0.5);
  expect(await getOffset()).toBe(3.5 * MS_DAY);
  expect(Math.abs(now.getTime() - Date.now() - 3.5 * MS_DAY)).toBeLessThan(1000);
  await resetClock(); expect(await getOffset()).toBe(0);
  await expect(fastForward(NaN)).rejects.toThrow("finite");
});

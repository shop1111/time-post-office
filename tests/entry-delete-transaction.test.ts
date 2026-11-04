import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type { testDatabase } from "./helpers/database";
import { db } from "@/lib/db";
import { DELETE } from "@/app/api/entries/[id]/route";
import { deleteUpload } from "@/lib/files";
import { DERIVED_REVISION_KEY, PROFILE_REVISION_KEY, getDerivedRevision } from "@/lib/memory/consistency";
const f = vi.hoisted(() => ({ fixture: undefined as unknown as ReturnType<typeof testDatabase> }));
vi.mock("@/lib/db", async () => {
  const { testDatabase } = await import("./helpers/database"); f.fixture = testDatabase("entry-delete-transaction");
  return { db: f.fixture.db };
});
vi.mock("@/lib/story", () => ({ generateStoryCard: vi.fn() }));
vi.mock("@/lib/files", () => ({ deleteUpload: vi.fn() }));
beforeAll(() => f.fixture.setup(), 30_000);
beforeEach(async () => {
  vi.restoreAllMocks(); vi.clearAllMocks(); vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.$transaction([db.job.deleteMany(), db.entry.deleteMany(), db.monthlyRecap.deleteMany(), db.setting.deleteMany()]);
  await db.setting.createMany({ data: [{ key: DERIVED_REVISION_KEY, value: "4" }, { key: PROFILE_REVISION_KEY, value: "4" }] });
  await db.monthlyRecap.createMany({ data: [{ month: "2026-10", payload: "{}" }, { month: "2026-11", payload: "{}" }] });
});
afterAll(async () => { vi.restoreAllMocks(); await f.fixture.cleanup(); });
async function setup(withMemories = true) {
  const entry = await db.entry.create({ data: { type: "text", text: "测试记录", occurredAt: new Date(), photoPath: "photo.jpg", audioPath: "voice.wav",
    ...(withMemories ? { memories: { create: ["active", "retracted"].map(status => ({ kind: "event", content: "关联记忆", status, occurredAt: new Date() })) } } : {}),
    messages: { create: { role: "user", content: "补充" } }, cards: { create: { title: "故事", narrative: "正文" } },
  } });
  await db.job.create({ data: { kind: "finalize", targetId: entry.id, checkpoint: "{}" } });
  return entry;
}
const remove = (id: string) => DELETE(new Request("http://test/entry", { method: "DELETE" }), { params: Promise.resolve({ id }) });
it.each([true, false])("真实事务：有记忆=%s，删除级联/任务/缓存，版本递增一次；重复删除404", async (hasMemories) => {
  const entry = await setup(hasMemories);
  expect((await remove(entry.id)).status).toBe(200);
  expect(await db.entry.count()).toBe(0); expect(await db.memory.count()).toBe(0); expect(await db.job.count()).toBe(0);
  expect(await db.entryMessage.count()).toBe(0); expect(await db.storyCard.count()).toBe(0); expect(await db.monthlyRecap.count()).toBe(0);
  expect(await getDerivedRevision(db)).toBe(5);
  expect((await db.setting.findUniqueOrThrow({ where: { key: PROFILE_REVISION_KEY } })).value).toBe("-1");
  expect(deleteUpload).toHaveBeenCalledTimes(2);
  vi.mocked(deleteUpload).mockClear();
  expect((await remove(entry.id)).status).toBe(404); expect(await getDerivedRevision(db)).toBe(5);
  expect(deleteUpload).not.toHaveBeenCalled();
});
it("失效最后一步失败也回滚Entry/记忆/Job/版本/缓存，文件不动，可重试", async () => {
  const entry = await setup();
  await db.$executeRawUnsafe('CREATE TRIGGER reject_cache_delete BEFORE DELETE ON "MonthlyRecap" BEGIN SELECT RAISE(ABORT, \'test invalidation failure\'); END');
  try {
    expect((await remove(entry.id)).status).toBe(500);
    expect(await db.entry.count()).toBe(1); expect(await db.memory.count()).toBe(2); expect(await db.job.count()).toBe(1);
    expect(await db.entryMessage.count()).toBe(1); expect(await db.storyCard.count()).toBe(1); expect(await db.monthlyRecap.count()).toBe(2);
    expect(await getDerivedRevision(db)).toBe(4);
    expect((await db.setting.findUniqueOrThrow({ where: { key: PROFILE_REVISION_KEY } })).value).toBe("4");
    expect(deleteUpload).not.toHaveBeenCalled();
  } finally { await db.$executeRawUnsafe('DROP TRIGGER reject_cache_delete'); }
  expect((await remove(entry.id)).status).toBe(200); expect(await getDerivedRevision(db)).toBe(5);
});

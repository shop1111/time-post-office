import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdir, writeFile, unlink, rmdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { DELETE } from "@/app/api/entries/[id]/route";
import { UPLOAD_DIR, deleteUpload } from "@/lib/files";
const f = vi.hoisted(() => ({ root: "", remove: vi.fn(), find: vi.fn(), jobs: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/db", () => {
  const tx = { entry: { findUnique: f.find, delete: f.remove }, job: { deleteMany: f.jobs } };
  // 全局写入口故意不提供：必须使用交互式事务传入的client。
  return { db: { $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx) } };
});
vi.mock("@/lib/memory/consistency", async (original) => ({ ...await original<typeof import("@/lib/memory/consistency")>(), invalidateDerived: f.invalidate }));
vi.mock("@/lib/story", () => ({ generateStoryCard: vi.fn() }));
vi.mock("@/lib/files", async (original) => {
  const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  f.root = mkdtempSync(join(tmpdir(), "time-post-office-delete-"));
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(f.root);
  try { return await original(); } finally { cwd.mockRestore(); }
});
const photo = () => path.join(UPLOAD_DIR, "photo.jpg"), voice = () => path.join(UPLOAD_DIR, "voice.wav");
beforeAll(async () => { await mkdir(UPLOAD_DIR, { recursive: true }); await mkdir(path.join(UPLOAD_DIR, "locked.wav")); });
beforeEach(async () => {
  vi.resetAllMocks(); vi.spyOn(console, "warn").mockImplementation(() => {});
  f.find.mockResolvedValue({ memories: [{ id: "memory" }] });
  f.jobs.mockResolvedValue({ count: 1 });
  f.remove.mockResolvedValue({ photoPath: "photo.jpg", audioPath: "voice.wav" });
  f.invalidate.mockResolvedValue({ derivedRevision: 1 });
  await writeFile(photo(), "photo"); await writeFile(voice(), "voice");
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { for (const name of [photo(), voice()]) if (existsSync(name)) await unlink(name); await rmdir(path.join(UPLOAD_DIR, "locked.wav")); await rmdir(UPLOAD_DIR); await rmdir(path.dirname(UPLOAD_DIR)); await rmdir(f.root); });
const remove = () => DELETE(new Request("http://test/entry", { method: "DELETE" }), { params: Promise.resolve({ id: "entry" }) });
it("数据库先删除，成功后照片和录音都清理", async () => {
  f.remove.mockImplementation(async () => { expect(existsSync(photo())).toBe(true); expect(existsSync(voice())).toBe(true); return { photoPath: "photo.jpg", audioPath: "voice.wav" }; });
  expect((await remove()).status).toBe(200); expect(existsSync(photo())).toBe(false); expect(existsSync(voice())).toBe(false);
  expect(f.invalidate).toHaveBeenCalledExactlyOnceWith({ entryId: "entry", memoryIds: ["memory"], reason: "entry_deleted" }, expect.any(Object));
  expect(f.jobs.mock.invocationCallOrder[0]).toBeLessThan(f.remove.mock.invocationCallOrder[0]);
  expect(f.remove.mock.invocationCallOrder[0]).toBeLessThan(f.invalidate.mock.invocationCallOrder[0]);
});
it("数据库删除失败时文件不动", async () => {
  f.remove.mockRejectedValue(new Error("database failure")); expect((await remove()).status).toBe(500);
  expect(f.invalidate).not.toHaveBeenCalled();
  expect(existsSync(photo())).toBe(true); expect(existsSync(voice())).toBe(true);
});
it("没有记忆也触发失效，覆盖记录本身的画像和月度统计", async () => {
  f.find.mockResolvedValue({ memories: [] });
  expect((await remove()).status).toBe(200);
  expect(f.invalidate).toHaveBeenCalledExactlyOnceWith({ entryId: "entry", memoryIds: [], reason: "entry_deleted" }, expect.any(Object));
});
it("失效失败不触碰照片或录音，返回通用错误体", async () => {
  f.invalidate.mockRejectedValue(new Error("invalidation failed"));
  const response = await remove(); expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "删除记录暂时失败，请稍后重试", code: "ENTRY_DELETE_FAILED", retryable: true });
  expect(existsSync(photo())).toBe(true); expect(existsSync(voice())).toBe(true);
});
it("记录不存在返回404，不删除任务、不失效、不动文件", async () => {
  f.find.mockResolvedValue(null);
  const response = await remove(); expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "找不到这条记录", code: "ENTRY_NOT_FOUND", retryable: false });
  expect(f.jobs).not.toHaveBeenCalled(); expect(f.remove).not.toHaveBeenCalled(); expect(f.invalidate).not.toHaveBeenCalled();
  expect(existsSync(photo())).toBe(true); expect(existsSync(voice())).toBe(true);
});
it("public插画和异常路径不删除，即使uploads内有同名文件", async () => {
  f.remove.mockResolvedValue({ photoPath: "/photo.jpg", audioPath: "../voice.wav" }); await remove();
  await deleteUpload("..\\voice.wav"); await deleteUpload("C:\\voice.wav"); await deleteUpload(".");
  expect(existsSync(photo())).toBe(true); expect(existsSync(voice())).toBe(true); expect(console.warn).not.toHaveBeenCalled();
});
it("清理一个文件失败只记日志，另一个仍清理，接口成功", async () => {
  f.remove.mockResolvedValue({ photoPath: "locked.wav", audioPath: "voice.wav" });
  expect(await (await remove()).json()).toEqual({ ok: true }); expect(existsSync(voice())).toBe(false);
  expect(console.warn).toHaveBeenCalledTimes(1);
});
it("文件已经消失仍可成功删除", async () => {
  f.remove.mockResolvedValue({ photoPath: "missing.jpg", audioPath: null });
  expect((await remove()).status).toBe(200); expect(console.warn).not.toHaveBeenCalled();
});

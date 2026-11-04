import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdir, writeFile, unlink, rmdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { DELETE } from "@/app/api/entries/[id]/route";
import { UPLOAD_DIR, deleteUpload } from "@/lib/files";
const f = vi.hoisted(() => ({ root: "", remove: vi.fn() }));
// 删除记录时和它的收进邮局任务在同一事务里删（组长在 main 上的修复）
vi.mock("@/lib/db", () => ({ db: { entry: { delete: f.remove }, job: { deleteMany: vi.fn(async () => ({ count: 0 })) }, $transaction: (ops: Promise<unknown>[]) => Promise.all(ops) } }));
vi.mock("@/lib/story", () => ({ generateStoryCard: vi.fn() }));
vi.mock("@/lib/files", async (original) => {
  const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  f.root = mkdtempSync(join(tmpdir(), "time-post-office-delete-"));
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(f.root);
  try { return await original(); } finally { cwd.mockRestore(); }
});
const photo = () => path.join(UPLOAD_DIR, "photo.jpg"), voice = () => path.join(UPLOAD_DIR, "voice.wav");
beforeAll(async () => { await mkdir(UPLOAD_DIR, { recursive: true }); await mkdir(path.join(UPLOAD_DIR, "locked.wav")); });
beforeEach(async () => { vi.clearAllMocks(); vi.spyOn(console, "warn").mockImplementation(() => {}); await writeFile(photo(), "photo"); await writeFile(voice(), "voice"); });
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { for (const name of [photo(), voice()]) if (existsSync(name)) await unlink(name); await rmdir(path.join(UPLOAD_DIR, "locked.wav")); await rmdir(UPLOAD_DIR); await rmdir(path.dirname(UPLOAD_DIR)); await rmdir(f.root); });
const remove = () => DELETE(new Request("http://test/entry", { method: "DELETE" }), { params: Promise.resolve({ id: "entry" }) });
it("数据库先删除，成功后照片和录音都清理", async () => {
  f.remove.mockImplementation(async () => { expect(existsSync(photo())).toBe(true); expect(existsSync(voice())).toBe(true); return { photoPath: "photo.jpg", audioPath: "voice.wav" }; });
  expect((await remove()).status).toBe(200); expect(existsSync(photo())).toBe(false); expect(existsSync(voice())).toBe(false);
});
it("数据库删除失败时文件不动", async () => {
  f.remove.mockRejectedValue(new Error("database failure")); await expect(remove()).rejects.toThrow("database failure");
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

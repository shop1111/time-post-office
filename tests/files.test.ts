import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdir, writeFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import { GET, HEAD } from "@/app/api/files/[name]/route";
import { UPLOAD_DIR, uploadName, saveUpload } from "@/lib/files";
const f = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/files", async (original) => {
  const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  f.root = mkdtempSync(join(tmpdir(), "time-post-office-files-"));
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(f.root);
  try { return await original(); } finally { cwd.mockRestore(); }
});
beforeAll(async () => { await mkdir(UPLOAD_DIR, { recursive: true }); await writeFile(path.join(UPLOAD_DIR, "voice.wav"), "0123456789"); await writeFile(path.join(UPLOAD_DIR, "empty.wav"), ""); await writeFile(path.join(f.root, "outside.txt"), "secret"); });
afterAll(async () => { for (const name of ["voice.wav", "empty.wav"]) await unlink(path.join(UPLOAD_DIR, name)); await unlink(path.join(f.root, "outside.txt")); await rmdir(UPLOAD_DIR); await rmdir(path.dirname(UPLOAD_DIR)); await rmdir(f.root); });
const request = (range?: string, name = "voice.wav") => GET(new Request("http://test/files", { headers: range === undefined ? {} : { Range: range } }), { params: Promise.resolve({ name }) });
it("完整文件200流式返回，提供长度及private缓存；HEAD没有正文", async () => {
  const result = await request();
  expect(result.status).toBe(200); expect(await result.text()).toBe("0123456789");
  expect(result.headers.get("content-length")).toBe("10"); expect(result.headers.get("accept-ranges")).toBe("bytes");
  expect(result.headers.get("content-type")).toBe("audio/wav"); expect(result.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  const head = await HEAD(new Request("http://test/files", { method: "HEAD" }), { params: Promise.resolve({ name: "voice.wav" }) });
  expect(head.headers.get("content-length")).toBe("10"); expect(await head.text()).toBe("");
});
it.each([["bytes=2-5", "2345", "bytes 2-5/10"], ["bytes=7-", "789", "bytes 7-9/10"], ["bytes=-3", "789", "bytes 7-9/10"], ["bytes=8-99", "89", "bytes 8-9/10"], ["bytes=-99", "0123456789", "bytes 0-9/10"]])("范围%s返回精确字节", async (range, body, contentRange) => {
  const result = await request(range); expect(result.status).toBe(206); expect(await result.text()).toBe(body);
  expect(result.headers.get("content-range")).toBe(contentRange); expect(result.headers.get("content-length")).toBe(String(body.length));
});
it.each(["bytes=10-", "bytes=6-2", "bytes=-0", "bytes=-", "bytes=a-b", "bytes=0-1,4-5", "items=0-1", "bytes=999999999999999999-", ""])("非法范围%s返回416", async (range) => {
  const result = await request(range); expect(result.status).toBe(416); expect(result.headers.get("content-range")).toBe("bytes */10");
  expect(result.headers.get("content-length")).toBe("0"); expect(result.headers.get("accept-ranges")).toBe("bytes"); expect(await result.text()).toBe("");
});
it("空文件200、其Range为416，缺失文件404", async () => {
  expect((await request(undefined, "empty.wav")).status).toBe(200);
  expect((await request("bytes=0-", "empty.wav")).status).toBe(416);
  expect((await request(undefined, "missing.wav")).status).toBe(404);
});
it("Windows/POSIX路径穿越只能访问uploads内的basename，不能逃逸", async () => {
  for (const name of ["../voice.wav", "..\\voice.wav", "C:\\private\\voice.wav"]) expect(await (await request(undefined, name)).text()).toBe("0123456789");
  for (const name of ["../outside.txt", "..\\outside.txt", "..", "voice.wav:secret"]) expect((await request(undefined, name)).status).toBe(404);
  expect(() => uploadName(".")).toThrow();
});
it("无扩展名的wav录音按MIME命名", async () => {
  const name = await saveUpload(new File(["wav"], "recording", { type: "audio/wav" }), "voice");
  expect(name).toMatch(/\.wav$/); await unlink(path.join(UPLOAD_DIR, name));
});

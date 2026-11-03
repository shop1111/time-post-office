import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdir, readdir, readFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import { POST } from "@/app/api/letters/[id]/speech/route";
import { GET } from "@/app/api/files/[name]/route";
import { UPLOAD_DIR } from "@/lib/files";
import { chat } from "@/lib/ai/provider";
const f = vi.hoisted(() => ({ root: "", letter: { id: "letter", body: "亲爱的你，愿你记得那天的日落。" }, find: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { letter: { findUnique: f.find } } }));
vi.mock("@/lib/files", async (original) => {
  const { mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { join } = await import("node:path");
  f.root = mkdtempSync(join(tmpdir(), "time-post-office-speech-"));
  const cwd = vi.spyOn(process, "cwd").mockReturnValue(f.root);
  try { return await original(); } finally { cwd.mockRestore(); }
});
// 假fetch的MP3形状字节仅测试传输/缓存，不声称是实际可播放的合成音频。
const bytes = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64)]);
const audio = () => new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } });
const request = () => POST(new Request("http://test/speech", { method: "POST" }), { params: Promise.resolve({ id: "letter" }) });
beforeAll(async () => mkdir(UPLOAD_DIR, { recursive: true }));
beforeEach(() => {
  vi.clearAllMocks(); f.letter = { id: "letter", body: "亲爱的你，愿你记得那天的日落。" }; f.find.mockImplementation(async () => ({ ...f.letter }));
  vi.stubEnv("TTS_BASE_URL", "https://compatible.example/v1"); vi.stubEnv("TTS_API_KEY", "test-only-placeholder");
  vi.stubEnv("TTS_MODEL", "test-tts"); vi.stubEnv("TTS_VOICE", "preset"); vi.stubEnv("TTS_TIMEOUT_MS", "1000");
  vi.stubEnv("AI_RETRY_BASE_MS", "1"); vi.stubEnv("AI_MAX_CONCURRENCY", "3");
  vi.stubGlobal("fetch", vi.fn(async () => audio())); vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(async () => {
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  for (const name of await readdir(UPLOAD_DIR)) await unlink(path.join(UPLOAD_DIR, name));
});
afterAll(async () => { await rmdir(UPLOAD_DIR); await rmdir(path.dirname(UPLOAD_DIR)); await rmdir(f.root); });
it.each(["TTS_BASE_URL", "TTS_API_KEY", "TTS_MODEL", "TTS_VOICE"])("未配置%s返回501，无请求无假音频", async (key) => {
  vi.stubEnv(key, ""); const result = await request(); expect(result.status).toBe(501);
  expect(await result.json()).toMatchObject({ code: "TTS_NOT_CONFIGURED", retryable: false });
  expect(fetch).not.toHaveBeenCalled(); expect(await readdir(UPLOAD_DIR)).toEqual([]);
});
it("成功写完整mp3，第二次直接命中且可Range播放", async () => {
  const first = await (await request()).json();
  expect(first).toMatchObject({ cached: false, execution: { mode: "remote", model: "test-tts" } });
  expect(first.url).toMatch(/^\/api\/files\/speech-[a-f0-9]{64}\.mp3$/);
  const name = first.url.split("/").pop(); expect(await readFile(path.join(UPLOAD_DIR, name))).toEqual(bytes);
  const init = vi.mocked(fetch).mock.calls[0][1]!;
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe("https://compatible.example/v1/audio/speech");
  expect(JSON.parse(String(init.body))).toEqual({ model: "test-tts", voice: "preset", input: f.letter.body, response_format: "mp3" });
  const second = await (await request()).json(); expect(second).toMatchObject({ url: first.url, cached: true, execution: { mode: "remote" } });
  expect(fetch).toHaveBeenCalledTimes(1); expect(await readdir(UPLOAD_DIR)).toEqual([name]);
  const range = await GET(new Request("http://test/files", { headers: { Range: "bytes=0-2" } }), { params: Promise.resolve({ name }) });
  expect(range.status).toBe(206); expect(await range.text()).toBe("ID3");
});
it("同一信并发12次只合成一次，等待者复用完成缓存", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); return audio(); }));
  const results = await Promise.all(Array.from({ length: 12 }, async () => (await request()).json()));
  expect(fetch).toHaveBeenCalledTimes(1); expect(new Set(results.map(r => r.url)).size).toBe(1);
  expect(results.filter(r => !r.cached)).toHaveLength(1); expect(await readdir(UPLOAD_DIR)).toHaveLength(1);
});
it("5xx重试耗尽返回502，不留文件；下次可重试成功", async () => {
  vi.mocked(fetch).mockImplementation(async () => new Response("private provider error", { status: 503 }));
  const result = await request(); expect(result.status).toBe(502); expect(await result.json()).toMatchObject({ code: "TTS_FAILED", retryable: true });
  expect(fetch).toHaveBeenCalledTimes(3); expect(await readdir(UPLOAD_DIR)).toEqual([]);
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("private provider error");
  vi.mocked(fetch).mockImplementation(async () => audio()); expect((await request()).status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("401不重试，429重试后成功", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));
  expect((await request()).status).toBe(502); expect(fetch).toHaveBeenCalledTimes(1);
  vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 429 }));
  expect((await request()).status).toBe(200); expect(fetch).toHaveBeenCalledTimes(3);
});
it.each(["json", "empty", "html", "oversize"])("HTTP200但%s不是有效音频，不缓存", async (kind) => {
  vi.mocked(fetch).mockImplementation(async () => kind === "json" ? Response.json({ error: "private" }) : kind === "empty" ? new Response(null) : kind === "oversize" ? new Response(bytes, { headers: { "Content-Length": String(26 * 1024 * 1024) } }) : new Response("<html>error</html>"));
  expect((await request()).status).toBe(502); expect(fetch).toHaveBeenCalledTimes(1); expect(await readdir(UPLOAD_DIR)).toEqual([]);
});
it("正文流挂起受总超时限制，未完成音频不入缓存", async () => {
  vi.useFakeTimers(); vi.stubEnv("TTS_TIMEOUT_MS", "30");
  let signal: AbortSignal | undefined; const cancel = vi.fn();
  vi.mocked(fetch).mockImplementation(async (_url, init) => { signal = init?.signal as AbortSignal; return new Response(new ReadableStream({ start(c) { c.enqueue(bytes); }, cancel })); });
  const result = request();
  // stat使用真实I/O，让请求到达fetch后再推进虚拟时钟。
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(30);
  expect((await result).status).toBe(502); expect(signal?.aborted).toBe(true); expect(cancel).toHaveBeenCalled();
  expect(await readdir(UPLOAD_DIR)).toEqual([]);
});
it("正文、模型、音色、服务端点变化都产生新缓存", async () => {
  const urls: string[] = [(await (await request()).json()).url];
  f.letter.body += "明天见。"; urls.push((await (await request()).json()).url);
  vi.stubEnv("TTS_MODEL", "different-model"); urls.push((await (await request()).json()).url);
  vi.stubEnv("TTS_VOICE", "different-preset"); urls.push((await (await request()).json()).url);
  vi.stubEnv("TTS_BASE_URL", "https://second.example/v1"); urls.push((await (await request()).json()).url);
  expect(new Set(urls).size).toBe(5); expect(fetch).toHaveBeenCalledTimes(5);
});
it("超长和空正文明确拒绝，不截断；4000字符完整发送", async () => {
  f.letter.body = "字".repeat(4001); const long = await request(); expect(long.status).toBe(400); expect(await long.json()).toMatchObject({ code: "TTS_TEXT_TOO_LONG", retryable: false });
  f.letter.body = "  "; expect((await request()).status).toBe(400); expect(fetch).not.toHaveBeenCalled();
  f.letter.body = "字".repeat(4000); expect((await request()).status).toBe(200);
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).input.length).toBe(4000);
});
it("不存在的信件404", async () => { f.find.mockResolvedValue(null); expect((await request()).status).toBe(404); expect(fetch).not.toHaveBeenCalled(); });
it("TTS与chat共享全局并发限制", async () => {
  vi.stubEnv("AI_MAX_CONCURRENCY", "1"); vi.stubEnv("CHAT_API_KEY", "test-only-placeholder"); vi.stubEnv("CHAT_BASE_URL", "https://compatible.example/v1"); vi.stubEnv("CHAT_MODEL", "test-chat");
  let active = 0, peak = 0;
  vi.mocked(fetch).mockImplementation(async (url) => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 20)); active--; return String(url).endsWith("/speech") ? audio() : Response.json({ choices: [{ message: { content: "回答" } }] }); });
  const [speech, result] = await Promise.all([request(), chat([{ role: "user", content: "问候" }], { mock: () => "本地" })]);
  expect(speech.status).toBe(200); expect(result).toBe("回答"); expect(peak).toBe(1); expect(fetch).toHaveBeenCalledTimes(2);
});

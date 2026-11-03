import { beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/entries/route";
const f = vi.hoisted(() => ({ create: vi.fn(), upload: vi.fn(), transcribe: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { entry: { create: f.create } } }));
vi.mock("@/lib/files", async (original) => ({ ...await original<typeof import("@/lib/files")>(), saveUpload: f.upload }));
vi.mock("@/lib/ai/provider", () => ({ describeImage: vi.fn(), transcribe: f.transcribe }));
vi.mock("@/lib/clock", () => ({ now: async () => new Date("2026-11-03T12:00:00Z") }));
beforeEach(() => { vi.clearAllMocks(); f.create.mockImplementation(({ data }) => ({ id: "entry", ...data })); f.transcribe.mockResolvedValue("转写"); });
it.each([["audio/webm;codecs=opus", "voice.webm", "audio/webm;codecs=opus"], ["", "voice.wav", "audio/wav"]])("录音路径入库，保留上传MIME或按扩展名补全：%s", async (mime, name, expected) => {
  f.upload.mockResolvedValue(name);
  const form = new FormData(); form.set("type", "voice"); form.set("audio", new File(["audio"], name, { type: mime }));
  const response = await POST(new Request("http://test/entries", { method: "POST", body: form }));
  expect(response.status).toBe(200);
  expect((await response.json()).entry).toMatchObject({ audioPath: name, audioMime: expected, transcript: "转写" });
  expect(f.upload).toHaveBeenCalledTimes(1);
});
it("有浏览器转写时不重复转写；文本记录的音频字段为null", async () => {
  f.upload.mockResolvedValue("voice.webm");
  const form = new FormData(); form.set("transcript", "浏览器转写"); form.set("audio", new File(["audio"], "voice.webm", { type: "audio/webm" }));
  await POST(new Request("http://test/entries", { method: "POST", body: form }));
  expect(f.transcribe).not.toHaveBeenCalled();
  const text = new FormData(); text.set("text", "文字日记");
  const response = await POST(new Request("http://test/entries", { method: "POST", body: text }));
  expect((await response.json()).entry).toMatchObject({ audioPath: null, audioMime: null });
});

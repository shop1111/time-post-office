import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkLetter } from "@/lib/postman/check";
const draft = "我和小林去过西湖。";
const revised = "记得那天走过西湖。";
const ok = { ok: true, issues: [] };
const bad = { ok: false, issues: ["小林没有依据", "日期没有依据"] };
beforeEach(() => {
  vi.stubEnv("CHAT_API_KEY", "test-only-placeholder"); vi.stubEnv("CHAT_BASE_URL", "https://compatible.example/v1"); vi.stubEnv("CHAT_MODEL", "test-model");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function provider(...values: Array<unknown>) {
  const fetcher = vi.fn(async () => {
    const value = values.shift();
    if (value instanceof Response) return value;
    return Response.json({ choices: [{ message: { content: typeof value === "string" ? value : JSON.stringify(value) } }] });
  });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
it("Mock为unchecked，绝不发核查请求", async () => {
  vi.stubEnv("CHAT_API_KEY", ""); const fetcher = provider();
  expect(await checkLetter(draft, "西湖")).toMatchObject({ body: draft, checkStatus: "unchecked", checkNote: expect.stringContaining("没有配置模型") });
  expect(fetcher).not.toHaveBeenCalled();
});
it("真实核查通过才是passed", async () => {
  provider(ok);
  expect((await checkLetter(draft, "西湖")).checkStatus).toBe("passed");
});
it("改写后必须核查新正文，通过后是rewritten且记录问题数", async () => {
  const fetcher = provider(bad, revised, ok);
  expect(await checkLetter(draft, "西湖")).toEqual({ body: revised, checkStatus: "rewritten", checkNote: "已改写 2 处无依据的说法" });
  expect(fetcher).toHaveBeenCalledTimes(3);
  const init = (fetcher.mock.calls[2] as unknown as [string, RequestInit])[1];
  expect(JSON.parse(String(init.body)).messages[1].content).toContain(revised);
  expect(JSON.parse(String(init.body)).messages[1].content).not.toContain(draft);
});
it("复检仍不通过为failed，投递改写版本并如实提示", async () => {
  provider(bad, revised, bad);
  expect(await checkLetter(draft, "西湖")).toMatchObject({ body: revised, checkStatus: "failed", checkNote: expect.stringContaining("仍有") });
});
it.each(["first", "rewrite", "recheck"])("%s调用降级为unchecked，保留原稿", async (phase) => {
  const failure = new Response(null, { status: 401 });
  provider(...phase === "first" ? [failure] : phase === "rewrite" ? [bad, failure] : [bad, revised, failure]);
  expect(await checkLetter(draft, "西湖")).toMatchObject({ body: draft, checkStatus: "unchecked" });
});
it("结构化核查输出损坏不能作为passed", async () => {
  provider("invalid", "invalid", "invalid");
  expect((await checkLetter(draft, "西湖")).checkStatus).toBe("unchecked");
});
it("ok=false但issues为空仍改写和复检，不能误标passed", async () => {
  provider({ ok: false, issues: [] }, revised, ok);
  expect((await checkLetter(draft, "西湖")).checkStatus).toBe("rewritten");
});

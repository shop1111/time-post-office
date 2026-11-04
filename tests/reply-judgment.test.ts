import { afterEach, expect, it, vi } from "vitest";
import { judgeReply, locallyAnsweredPlans } from "@/lib/letters/reply";
const plans = [{ id: "exam", content: "下周参加摄影考试" }, { id: "interview", content: "准备参加工作面试" }];
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it.each(["还没考，推迟到下个月", "还没考过", "准备下周考", "还没完成，改天再说", "结果什么时候出来？", "准备下周考完", "午饭搞定了！"])("Mock不把未完成或无关回复关闭：%s", (reply) => {
  expect(locallyAnsweredPlans([plans[0]], reply)).toEqual([]);
});
it.each(["考完了，过了！", "考完了，可惜没过。", "考试结果公布了，通过了", "考完了，可惜没考好", "准备了三个月，终于考完了"])("Mock明确回答考试才关闭：%s", (reply) => {
  expect(locallyAnsweredPlans(plans, reply)).toEqual(["exam"]);
});
it.each(["没考过，差两分", "没考好", "考砸了", "挂了", "没通过", "挂了，差两分"])("Mock简短考试结果也能关闭唯一考试计划：%s", (reply) => {
  expect(locallyAnsweredPlans([plans[0]], reply)).toEqual(["exam"]);
});
it.each(["面试挂了", "面试没通过"])("不把其他领域的失败结果当考试结果：%s", (reply) => {
  expect(locallyAnsweredPlans([plans[0]], reply)).toEqual([]);
  expect(locallyAnsweredPlans(plans, reply)).toEqual(["interview"]);
});
it.each(["挂了", "没通过"])("多个计划不凭含糊的失败结果猜测目标：%s", (reply) => {
  expect(locallyAnsweredPlans(plans, reply)).toEqual([]);
});
it("多计划笼统回答不全关，单计划明确确认可以关闭", () => {
  expect(locallyAnsweredPlans(plans, "搞定了！")).toEqual([]);
  expect(locallyAnsweredPlans([plans[0]], "搞定了！")).toEqual(["exam"]);
});
it.each([false, true])("真实判断完成=%s，过滤伪造ID并保留未回答计划", async (finished) => {
  vi.stubEnv("CHAT_API_KEY", "test-only-placeholder"); vi.stubEnv("CHAT_BASE_URL", "https://compatible.example/v1"); vi.stubEnv("CHAT_MODEL", "test-model");
  const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ answeredPlanIds: finished ? ["exam", "invented"] : [] }) } }] }));
  vi.stubGlobal("fetch", fetcher);
  expect(await judgeReply(plans, finished ? "考完了，过了！" : "还没考，推迟到下个月")).toEqual(finished ? ["exam"] : []);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("核查判断降级后用本地规则，明确推迟即使模型误报也不关", async () => {
  vi.stubEnv("CHAT_API_KEY", "test-only-placeholder"); vi.stubEnv("CHAT_BASE_URL", "https://compatible.example/v1"); vi.stubEnv("CHAT_MODEL", "test-model");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", async () => new Response(null, { status: 401 }));
  expect(await judgeReply(plans, "考完了，过了！")).toEqual(["exam"]);
  vi.stubGlobal("fetch", async () => Response.json({ choices: [{ message: { content: '{"answeredPlanIds":["exam"]}' } }] }));
  expect(await judgeReply(plans, "还没考，推迟到下个月")).toEqual([]);
  expect(await judgeReply(plans, "还没考过")).toEqual([]);
  expect(await judgeReply(plans, "准备下周考")).toEqual([]);
  expect(await judgeReply(plans, "考完了，可惜没考好")).toEqual(["exam"]);
});

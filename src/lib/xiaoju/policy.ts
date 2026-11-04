import { z } from "zod";
import { chat } from "@/lib/ai/provider";
import { extractJson } from "@/lib/ai/json";
import { XIAOJU_PERSONA, DIALOGUE_EXAMPLES } from "./persona";

export const PlanSchema = z.object({
  act: z.enum(["respond", "ask", "clarify", "answer", "advise", "close"]),
  focus: z.string().max(160),
  explicitEmotion: z.array(z.string().max(20)).max(4).default([]),
  uncertainty: z.array(z.string().max(100)).max(4).default([]),
  openThreads: z.array(z.string().max(100)).max(4).default([]),
  askedTopics: z.array(z.string().max(100)).max(8).default([]),
  corrections: z.array(z.string().max(120)).max(4).default([]),
  details: z.array(z.object({ messageId: z.string(), quote: z.string().max(200) })).max(8).default([]),
  question: z.string().max(120).nullable().default(null),
  useMemoryIds: z.array(z.string()).max(2).default([]),
  avoid: z.array(z.string().max(80)).max(5).default([]),
});
export type DialoguePlan = z.infer<typeof PlanSchema>;

/** One bounded decision call; never expose plans or chain-of-thought to the client. */
export async function decide(context: unknown): Promise<DialoguePlan> {
  const raw = await chat([
    { role: "system", content: `${XIAOJU_PERSONA}\n${DIALOGUE_EXAMPLES}
你负责选择下一步交流动作，不写回复，不输出推理过程。只输出 JSON：
{"act":"respond|ask|clarify|answer|advise|close","focus":"当前焦点","explicitEmotion":[],"uncertainty":[],"openThreads":[],"askedTopics":[],"corrections":[],"details":[],"question":null,"useMemoryIds":[],"avoid":[]}
接话优先，问题可选。用户正在展开时别换方向。只有有依据、能帮助用户继续讲的疑问才选 ask；不为了凑轮数发问。
不清楚含义时选 clarify，不用旧事填补含义。用户没有要求建议时优先倾听。
askedTopics 汇总已问过的点，corrections 保留用户纠正；推测只放 uncertainty，不写成事实。
details 保留本次聊天用户明确说过的重要原话片段，最多8条 {messageId,quote}，只能引用 user 消息真实id及连续原文。结合 previousState.details 延续有效细节，用户后来的纠正优先。不保存助手猜测。
候选记忆默认不用：只有确实相关且有助于当前交流才选 ID，最多两条。不要把近期或同词当成相关。
偏好证据只用于交流方式，不当成人格诊断。` },
    { role: "user", content: JSON.stringify(context) },
  ], { json: true, temperature: 0.2, maxTokens: 700, timeoutMs: 20_000, fallbackPolicy: "error", mock: () => "" });
  const plan = PlanSchema.parse(extractJson(raw));
  if (plan.act !== "ask" && plan.act !== "clarify") plan.question = null;
  if (plan.act === "clarify") plan.useMemoryIds = [];
  return plan;
}

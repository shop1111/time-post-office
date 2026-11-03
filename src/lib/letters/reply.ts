import { z } from "zod";
import { chatJson } from "@/lib/ai/json";
import { replyJudgmentMessages } from "@/lib/ai/reply-prompts";
import type { CallOptions } from "@/lib/ai/provider";

type Plan = { id: string; content: string };
const pending = /还没|尚未|未完成|没(?:有)?考|推迟|延期|改天|还在准备|结果.*(?:什么时候|何时)|(?:打算|准备|计划).*(?:考|做|完成)/;
const completed = /考完|考试结束|考过了|考了|通过了|过了|没过|结果(?:出来|公布|是)|完成了|已完成|搞定|结束了|跑完|面试完|面试结束|答辩完|办完|做完|取消了|不去了|放弃了/;
const domains = [
  { plan: /考试|考证|考研|考驾|驾照|科目|笔试|考一次/, reply: /考完|考试|考过|考了|考证|驾照|笔试|成绩/ },
  { plan: /面试|求职/, reply: /面试|录用|offer/i },
  { plan: /答辩|论文/, reply: /答辩|论文/ },
  { plan: /跑步|马拉松|长跑/, reply: /跑|马拉松/ },
];
/** 宁可不关，也不把“午饭搞定了”当成考试结果；笼统确认仅用于唯一计划。 */
export function locallyAnsweredPlans(plans: Plan[], reply: string): string[] {
  if (pending.test(reply) || !completed.test(reply)) return [];
  const generic = /^(?:已经|都|我)?(?:完成了|搞定了?[！!]?|结束了|过了|没过|结果出来了|取消了|不去了|放弃了)[\s。！!，,]*$/;
  return plans.filter((plan) => {
    if (plans.length === 1 && generic.test(reply.trim())) return true;
    const domain = domains.find((item) => item.plan.test(plan.content));
    if (domain) return domain.reply.test(reply) || (plans.length === 1 && /结果|通过|过了|没过/.test(reply));
    const grams = new Set((plan.content.match(/[\p{L}\p{N}]+/gu) ?? []).flatMap((word) => Array.from({ length: Math.max(0, word.length - 1) }, (_, i) => word.slice(i, i + 2))));
    return [...grams].filter((gram) => reply.includes(gram) && !["计划", "准备", "明天", "下周", "完成"].includes(gram)).length >= 2;
  }).map((plan) => plan.id);
}

export async function judgeReply(plans: Plan[], reply: string, options: CallOptions = {}): Promise<string[]> {
  if (!plans.length) return [];
  const result = await chatJson(z.object({ answeredPlanIds: z.array(z.string()).max(20) }), replyJudgmentMessages(plans, reply), {
    ...options, purpose: options.purpose ?? "reply", temperature: 0, maxTokens: 250,
    mock: () => ({ answeredPlanIds: locallyAnsweredPlans(plans, reply) }),
  });
  // 对明确的“尚未/推迟”做保守硬保护，即使模型误报，也不关计划。
  if (pending.test(reply)) return [];
  const valid = new Set(plans.map((plan) => plan.id));
  return [...new Set(result.answeredPlanIds.filter((id) => valid.has(id)))];
}

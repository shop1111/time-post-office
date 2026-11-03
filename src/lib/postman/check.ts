import { z } from "zod";
import { chat, isMock, type CallOptions } from "@/lib/ai/provider";
import { chatJson } from "@/lib/ai/json";
import { selfCheckMessages, rewriteMessages } from "@/lib/ai/prompts";
import { logError } from "@/lib/errors";
import type { ExecutionInfo, LetterCheckInfo } from "@/lib/types";

const Check = z.object({ ok: z.boolean(), issues: z.array(z.string().trim().min(1).max(400)).max(20).default([]) });
export interface CheckedLetter extends LetterCheckInfo { body: string }

/** 任何服务降级都不能当作核查通过。最多一次改写，且必须对改写后的正文复检。 */
export async function checkLetter(body: string, memories: string, options: CallOptions = {}): Promise<CheckedLetter> {
  const unchecked = (checkNote: string): CheckedLetter => ({ body, checkStatus: "unchecked", checkNote });
  if (isMock()) return unchecked("没有配置模型，未做事实核查");
  const verify = async (text: string) => {
    let execution: ExecutionInfo | undefined;
    const result = await chatJson(Check, selfCheckMessages(text, memories), {
      ...options, temperature: 0, mock: () => ({ ok: false, issues: [] }),
      onExecution: (info) => { execution = info; options.onExecution?.(info); },
    });
    return { result, remote: execution?.mode === "remote" };
  };
  try {
    const first = await verify(body);
    if (!first.remote) return unchecked("核查服务暂时不可用，未完成事实核查");
    if (first.result.ok && !first.result.issues.length) return { body, checkStatus: "passed", checkNote: "事实核查通过" };
    const issues = [...new Set(first.result.issues)];
    if (!issues.length) issues.push("核查未通过，请删去所有无法从记忆中找到依据的具体说法");
    let rewriteExecution: ExecutionInfo | undefined;
    const rewritten = await chat(rewriteMessages(body, issues, memories), {
      ...options, temperature: 0.5, maxTokens: 1400, mock: () => body,
      onExecution: (info) => { rewriteExecution = info; options.onExecution?.(info); },
    });
    if (rewriteExecution?.mode !== "remote") return unchecked("改写服务暂时不可用，保留原稿且未完成核查");
    const second = await verify(rewritten);
    if (!second.remote) return unchecked("复检服务暂时不可用，保留原稿且未完成核查");
    if (!second.result.ok || second.result.issues.length) return { body: rewritten, checkStatus: "failed", checkNote: "改写后仍有无法核实的说法，请谨慎阅读" };
    return { body: rewritten, checkStatus: "rewritten", checkNote: `已改写 ${issues.length} 处无依据的说法` };
  } catch (error) {
    logError("postman.check", error);
    return unchecked("核查服务暂时不可用，保留原稿且未完成核查");
  }
}

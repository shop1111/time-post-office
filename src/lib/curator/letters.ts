/**
 * 小局来信的出厂检查：输出防线 → 去 AI 腔改写（真实模型下）。
 */
import { chat, isMock } from "@/lib/ai/provider";
import { voiceRewriteMessages } from "@/lib/ai/prompts";
import { guardOutput } from "./guard";
import { lintVoice } from "./voice";

/** AI 腔分数达到这个值就改写一次 */
export const VOICE_REWRITE_THRESHOLD = 2;

export async function polishCuratorLetter<T extends { subject: string; body: string; cited: string[] }>(draft: T, mock: () => T): Promise<T> {
  if (guardOutput(`${draft.subject}\n${draft.body}`).kind !== "ok") {
    console.warn("[letter] output guard，改用本地模板");
    return mock();
  }
  const lint = lintVoice(draft.body);
  if (isMock() || lint.score < VOICE_REWRITE_THRESHOLD) return draft;
  const fixed = (await chat(voiceRewriteMessages(draft.body, lint.hits), { temperature: 0.6, maxTokens: 1400, mock: () => draft.body })).trim();
  // 只有确实变好、而且没有被带歪时才采用
  if (fixed.length >= 40 && guardOutput(fixed).kind === "ok" && lintVoice(fixed).score < lint.score) return { ...draft, body: fixed };
  return draft;
}

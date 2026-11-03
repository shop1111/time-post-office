import { randomUUID } from "node:crypto";
import { fastForward, now, resetClock } from "@/lib/clock";
import type { PostmanEvents, PostmanRequest, PostmanResult } from "@/lib/types";
import { tickWithinAction } from "./engine";
import { serializePostman } from "./queue";

export type PostmanObserver = <K extends keyof PostmanEvents>(event: K, data: PostmanEvents[K]) => void;
/** 从拨时钟到投递都占据同一个队列槽，SSE/JSON及直接tick共用这条队列。 */
export function runPostmanAction(request: PostmanRequest = {}, onEvent?: PostmanObserver): Promise<PostmanResult> {
  const runId = randomUUID();
  const started = Date.now();
  const action = request.action ?? "tick";
  const days = Math.max(1, Math.min(400, Number(request.days) || 30));
  return serializePostman(async () => {
    const from = await now();
    let to = from;
    if (action === "forward") to = await fastForward(days);
    else if (action === "reset") { await resetClock(); to = await now(); }
    onEvent?.("meta", { runId, action, from: from.toISOString(), to: to.toISOString() });
    const result: PostmanResult = action === "reset" ? {
      now: to.toISOString(), ok: true, runId, durationMs: 0, delivered: [], generated: [], candidates: [], decisions: [], totalCandidates: 0, skippedByRateLimit: false,
    } : await tickWithinAction({
      now: to, runId, maxLetters: action === "forward" ? days >= 60 ? 3 : 2 : 1, ignoreGap: action === "forward" || action === "force",
      onDecision: (decision) => onEvent?.("decision", decision), onStage: (stage) => onEvent?.("stage", stage),
    });
    result.durationMs = Date.now() - started; // 包含在动作队列里等待的时间。
    onEvent?.("done", { result });
    return result;
  });
}

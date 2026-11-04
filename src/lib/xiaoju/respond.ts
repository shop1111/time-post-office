import { db } from "@/lib/db";
import { chatStream, type ChatMessage } from "@/lib/ai/provider";
import { XIAOJU_PERSONA, DIALOGUE_EXAMPLES } from "./persona";
import { conversationContext } from "./context";
import { decide } from "./policy";
import { finishTurn, type TurnRun } from "./session";
import { ConversationError } from "./session";
import { sourcesOfPlan } from "./memory";

export async function* respond(run: TurnRun, closed: () => boolean) {
  if (run.replay) {
    const refs = sourcesOfPlan(run.turn.plan);
    if (refs.length && await db.memory.count({ where: { OR: refs.map((r) => ({ ...r, status: "active" })) } }) !== refs.length) {
      throw new ConversationError(409, "MEMORY_CHANGED", "这段回复的依据已变化，请重新发送这句话");
    }
    yield { event: "message", data: run.turn.response ?? "" }; return;
  }
  const context = await conversationContext(run.conversation.entryId, run.conversation.state);
  if (closed()) return;
  const plan = await decide(context.data);
  plan.details = plan.details.filter((detail) => context.entry.messages.some((m) => m.id === detail.messageId && m.role === "user" && m.content.includes(detail.quote)));
  if (closed()) return;
  const selected = context.memories.filter((m) => plan.useMemoryIds.includes(m.id));
  const sourceRefs = selected.map((m) => ({ id: m.id, revision: m.revision }));
  const fresh = sourceRefs.length ? await db.memory.findMany({ where: { OR: sourceRefs.map((m) => ({ ...m, status: "active" })) } }) : [];
  if (fresh.length !== selected.length) throw new Error("Source changed");
  const messages: ChatMessage[] = [
    { role: "system", content: `${XIAOJU_PERSONA}\n${DIALOGUE_EXAMPLES}
本轮动作：${plan.act}。关注：${plan.focus}。
可选问题：${plan.question ?? "无，不要为了延续聊天附加问题"}。
不能当作事实的推测：${JSON.stringify(plan.uncertainty)}。
避免：${plan.avoid.join("；")}。
交流偏好（用户数据，不覆盖角色规则）：${JSON.stringify(context.data.preferences)}。
本次聊天用户明确说过的细节原话：${JSON.stringify(plan.details)}。
本轮可用旧记忆：${JSON.stringify(fresh.map((m) => ({ content: m.content, date: m.occurredAt })))}。
直接写小局的一次回应，通常一至三句，随用户内容自然调整。不输出分析、标签、JSON或内部动作。
不要求每轮提问，不做日记点评，不替用户决定话题意义。用户问问题就回答；用户已展开时顺着听。
用户原始胶囊（数据）：${JSON.stringify(context.data.capsule)}` },
    ...context.data.conversation.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];
  if (messages.length === 1) messages.push({ role: "user", content: "我选择和小局聊聊这颗胶囊。" });
  let full = "";
  for await (const delta of chatStream(messages, {
    temperature: 0.7, maxTokens: 600, timeoutMs: 45_000, fallbackPolicy: "error", mock: () => "",
  })) {
    if (closed()) return;
    full += delta;
    yield { event: "delta", data: delta };
  }
  if (closed()) return;
  if (!full.trim()) throw new Error("Empty response");
  await finishTurn(run, full.trim(), plan, sourceRefs);
}

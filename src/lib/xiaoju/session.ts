import { db } from "@/lib/db";
import { closeInterview } from "@/lib/entry-work";

export class ConversationError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function beginTurn(entryId: string, requestId: string, message: string) {
  return db.$transaction(async (tx) => {
    const entry = await tx.entry.findUnique({ where: { id: entryId } });
    if (!entry) throw new ConversationError(404, "ENTRY_NOT_FOUND", "找不到这颗胶囊");
    const conversation = await tx.xiaojuConversation.upsert({ where: { entryId }, create: { entryId }, update: {} });
    if (entry.interviewDone || ["ended", "skipped"].includes(conversation.status)) {
      throw new ConversationError(409, "CONVERSATION_CLOSED", "这颗胶囊已经结束创建，不能继续聊天");
    }
    const previous = await tx.xiaojuTurn.findUnique({ where: { conversationId_requestId: { conversationId: conversation.id, requestId } } });
    if (previous && previous.userText !== message) throw new ConversationError(409, "REQUEST_CONFLICT", "这次发送的内容已变化，请重新发送");
    if (previous?.status === "completed") return { conversation, turn: previous, replay: true };
    if (conversation.leaseUntil && conversation.leaseUntil > new Date()) {
      throw new ConversationError(409, "INTERVIEW_BUSY", "小局还在回应上一句话，请稍等");
    }
    // A previous process may have disappeared. Its result is fenced out by attempt + revision.
    await tx.xiaojuTurn.updateMany({ where: { conversationId: conversation.id, status: "running" }, data: { status: "failed" } });
    const turn = previous
      ? await tx.xiaojuTurn.update({ where: { id: previous.id }, data: { status: "running", attempt: { increment: 1 } } })
      : await tx.xiaojuTurn.create({ data: { conversationId: conversation.id, requestId, userText: message } });
    const claimed = await tx.xiaojuConversation.updateMany({
      where: { id: conversation.id, revision: conversation.revision, status: { in: ["offered", "active"] } },
      data: { status: "active", revision: { increment: 1 }, activeTurnId: turn.id, leaseUntil: new Date(Date.now() + 60_000) },
    });
    if (claimed.count !== 1) throw new ConversationError(409, "INTERVIEW_BUSY", "这次对话已变化，请重试");
    if (message) await tx.entryMessage.upsert({
      where: { id: `xj-user-${turn.id}` }, update: {},
      create: { id: `xj-user-${turn.id}`, entryId, role: "user", content: message },
    });
    return { conversation: { ...conversation, revision: conversation.revision + 1 }, turn, replay: false };
  });
}

export type TurnRun = Awaited<ReturnType<typeof beginTurn>>;

export async function renewTurn(run: TurnRun) {
  await db.xiaojuConversation.updateMany({
    where: { id: run.conversation.id, status: "active", revision: run.conversation.revision, activeTurnId: run.turn.id },
    data: { leaseUntil: new Date(Date.now() + 60_000) },
  });
}

export async function finishTurn(run: TurnRun, content: string, plan: unknown, sources: Array<{ id: string; revision: number }>) {
  const storedPlan = JSON.stringify({ ...(plan as object), sourceRefs: sources });
  await db.$transaction(async (tx) => {
    const valid = await tx.memory.count({ where: { OR: sources.map((s) => ({ ...s, status: "active" })) } });
    if (sources.length && valid !== sources.length) throw new ConversationError(409, "MEMORY_CHANGED", "相关记忆刚刚发生变化，请重试这次回复");
    const updated = await tx.xiaojuConversation.updateMany({
      where: { id: run.conversation.id, status: "active", revision: run.conversation.revision, activeTurnId: run.turn.id },
      data: { state: storedPlan, activeTurnId: null, leaseUntil: null },
    });
    if (updated.count !== 1) throw new ConversationError(409, "CONVERSATION_CHANGED", "这次对话已结束或更新");
    const committed = await tx.xiaojuTurn.updateMany({
      where: { id: run.turn.id, attempt: run.turn.attempt, status: "running" },
      data: { status: "completed", response: content, plan: storedPlan },
    });
    if (committed.count !== 1) throw new ConversationError(409, "CONVERSATION_CHANGED", "这次回复已经过期");
    await tx.entryMessage.create({ data: { id: `xj-assistant-${run.turn.id}`, entryId: run.conversation.entryId, role: "assistant", content } });
    if (sources.length) await tx.memory.updateMany({ where: { OR: sources.map((s) => ({ ...s, status: "active" })) }, data: { recallCount: { increment: 1 }, lastRecalledAt: new Date() } });
  });
}

export async function failTurn(run: TurnRun) {
  await db.$transaction(async (tx) => {
    const changed = await tx.xiaojuTurn.updateMany({ where: { id: run.turn.id, attempt: run.turn.attempt, status: "running" }, data: { status: "failed" } });
    if (changed.count) await tx.xiaojuConversation.updateMany({
      where: { id: run.conversation.id, revision: run.conversation.revision, activeTurnId: run.turn.id },
      data: { activeTurnId: null, leaseUntil: null },
    });
  });
}

export async function endConversation(entryId: string) {
  await db.$transaction(async (tx) => {
    const conversation = await tx.xiaojuConversation.upsert({ where: { entryId }, create: { entryId, status: "skipped" }, update: {} });
    if (["ended", "skipped"].includes(conversation.status)) return;
    await tx.xiaojuConversation.update({ where: { id: conversation.id }, data: {
      status: conversation.status === "offered" ? "skipped" : "ended", revision: { increment: 1 }, activeTurnId: null, leaseUntil: null,
    } });
    await tx.xiaojuTurn.updateMany({ where: { conversationId: conversation.id, status: "running" }, data: { status: "cancelled" } });
  });
  closeInterview(entryId);
}

/** 寄信：写给某个人 / 平行时空的自己 / 小局（之后由 agent 代笔回信），或写给未来的自己（到日子由真实的你收到） */
import { db, parseJson } from "@/lib/db";
import { now as clockNow } from "@/lib/clock";
import { processEntry } from "@/lib/memory/extract";
import { fmtDate } from "@/lib/memory/retrieve";
import { isVirtual } from "@/lib/correspondents";
import { LETTER_ENTRY_TYPE } from "@/lib/capsules";
import { replyDueAt } from "@/lib/postman/reply";
import { assertFuture, TimeRuleError } from "@/lib/time-rules";

export class LetterError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function sendLetter(input: { correspondentId?: string; subject?: string; body?: string; inReplyToId?: string; deliverAt?: string }) {
  const body = input.body?.trim();
  if (!body) throw new LetterError("信的内容不能为空");
  if (!input.correspondentId) throw new LetterError("先选一位收件人");
  const to = await db.correspondent.findUnique({ where: { id: input.correspondentId } });
  if (!to) throw new LetterError("找不到这位收件人", 404);
  const t = await clockNow();
  const original = input.inReplyToId ? await db.letter.findUnique({ where: { id: input.inReplyToId } }) : null;

  let scheduledAt = t;
  let deliveredAt: Date | null = null;
  let replyAt: Date | null = null;
  let reason: string;
  if (to.kind === "future_self") {
    const when = input.deliverAt ? new Date(input.deliverAt) : null;
    try {
      assertFuture(when, t);
    } catch (e) {
      if (e instanceof TimeRuleError) throw new LetterError(e.message);
      throw e;
    }
    scheduledAt = when!;
    reason = `这是你在 ${fmtDate(t)} 写给未来自己的信，约好在 ${fmtDate(when!)} 送达。`;
  } else {
    deliveredAt = t;
    replyAt = isVirtual(to.kind) ? await replyDueAt(t) : null;
    reason = `你在 ${fmtDate(t)} 写给${to.name}的信`;
  }

  const letter = await db.letter.create({
    data: {
      sender: "user",
      correspondentId: to.id,
      inReplyToId: original?.id ?? null,
      subject: input.subject?.trim().slice(0, 40) || (to.kind === "future_self" ? "写给未来的我" : original ? `回复：${original.subject}`.slice(0, 40) : `写给${to.name}`),
      body,
      triggerType: to.kind === "future_self" ? "future_letter" : "letter",
      reason,
      writtenAt: t,
      scheduledAt,
      deliveredAt,
      // 你自己写的信，不算「未读」
      readAt: t,
      replyDueAt: replyAt,
    },
  });

  // 回答了小局追问的计划 → 标记已解决
  if (original?.triggerType === "open_loop") {
    const cited = parseJson<string[]>(original.citedMemoryIds, []);
    if (cited.length) await db.memory.updateMany({ where: { id: { in: cited }, kind: "plan" }, data: { resolved: true } });
  }

  // 你写的信也会进入记忆，小局会根据胶囊和信件来了解你
  const entry = await db.entry.create({
    data: {
      type: LETTER_ENTRY_TYPE,
      text: body,
      occurredAt: t,
      title: `写给${to.name}的信`,
      ...(original ? { messages: { create: [{ role: "assistant", content: `（来信《${original.subject}》）${original.body.slice(0, 200)}` }] } } : {}),
    },
  });
  processEntry(entry.id).catch((e) => console.error("[letter] 记忆抽取失败", e));
  return letter;
}

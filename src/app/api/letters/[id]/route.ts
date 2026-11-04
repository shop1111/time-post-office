import { db, parseJson } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { now } from "@/lib/clock";
import { startFinalize } from "@/lib/jobs";
import { judgeReply } from "@/lib/letters/reply";
import { logError } from "@/lib/errors";
import { SENDER_LABEL, type ApiError, type Sender, type ExecutionInfo } from "@/lib/types";

export const runtime = "nodejs";
const fail = (status: number, code: string, error: string, retryable = false) => Response.json({ error, code, retryable } satisfies ApiError, { status });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = await req.json().catch(() => null) as { action?: string; reply?: unknown } | null;
    if (!input || !["read", "reply"].includes(input.action ?? "")) return fail(400, "INVALID_LETTER_ACTION", "请指定已读或回信操作");
    const original = await db.letter.findUnique({ where: { id } });
    if (!original) return fail(404, "LETTER_NOT_FOUND", "找不到这封信");
    const t = await now();
    if (input.action === "read") return Response.json({ letter: await db.letter.update({ where: { id }, data: { readAt: t } }) });
    if (typeof input.reply !== "string" || !input.reply.trim()) return fail(400, "EMPTY_REPLY", "回信内容不能为空");
    const reply = input.reply.trim();
    // loop:memoryId 是这封信真正追问的目标；其他引用可能只是补充背景，不能一并关闭。
    const ids = original.triggerKey?.startsWith("loop:") ? [original.triggerKey.slice(5)] : parseJson<string[]>(original.citedMemoryIds, []);
    const plans = original.triggerType === "open_loop" ? await db.memory.findMany({ where: { id: { in: ids }, kind: "plan", resolved: false, ...ACTIVE_MEMORY }, select: { id: true, content: true } }) : [];
    let execution: ExecutionInfo | undefined;
    const answered = await judgeReply(plans, reply, { onExecution: (info) => { execution = info; } });
    const saved = await db.$transaction(async (tx) => {
      const letter = await tx.letter.update({ where: { id }, data: { reply, repliedAt: t, readAt: t } });
      const resolvedPlanIds: string[] = [];
      for (const plan of plans.filter((plan) => answered.includes(plan.id))) {
        // 判断期间若原计划被人工修改，不用旧判断去关闭新内容。
        const result = await tx.memory.updateMany({ where: { id: plan.id, content: plan.content, kind: "plan", resolved: false }, data: { resolved: true } });
        if (result.count) resolvedPlanIds.push(plan.id);
      }
      const entry = await tx.entry.create({ data: {
        type: "text", text: reply, occurredAt: t, title: `回信给${SENDER_LABEL[letter.sender as Sender] ?? "邮差"}`,
        messages: { create: [{ role: "assistant", content: `（来信《${letter.subject}》）${letter.body.slice(0, 200)}` }] },
      } });
      // 与回信同事务先建立可查询任务；即使提交后进程退出也能重试这条记录。
      const job = await tx.job.create({ data: { kind: "finalize", targetId: entry.id } });
      return { letter, entry, job, resolvedPlanIds };
    });
    let jobStatus = saved.job.status;
    try { const { run } = await startFinalize(saved.entry.id); jobStatus = run.state.status; }
    catch (error) {
      logError("reply.finalize", error);
      jobStatus = "failed";
      await db.job.update({ where: { id: saved.job.id }, data: { status: "failed", error: JSON.stringify({ code: "FINALIZE_START_FAILED", message: "回信已保存，收进邮局任务未启动，请重试", retryable: true }) } }).catch((error) => logError("reply.job", error));
    }
    return Response.json({ letter: saved.letter, replyEntryId: saved.entry.id, jobId: saved.job.id, jobStatus, resolvedPlanIds: saved.resolvedPlanIds, ...(execution ? { execution } : {}) });
  } catch (error) {
    logError("letter.reply", error);
    return fail(500, "LETTER_REPLY_FAILED", "回信暂时失败，请稍后重试", true);
  }
}

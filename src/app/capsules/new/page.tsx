import { userPage } from "@/lib/auth";
import { redirect } from "next/navigation";
import { RecordFlow, type ResumeState } from "@/components/record/RecordFlow";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { getFinalizeStatus, JobRequestError } from "@/lib/jobs";
import { interviewState } from "@/lib/curator/planner";

async function RecordPage({ searchParams }: { searchParams: Promise<{ type?: string; entry?: string; direct?: string }> }) {
  const { type, entry, direct } = await searchParams;
  const t = await now();
  const initial = type === "photo" || type === "voice" ? type : "text";
  const resume = entry ? await loadResume(entry, direct === "1") : null;
  // 不要给 RecordFlow 加随 entry 变化的 key：寄出后前端会把 ?entry= 写进地址栏，换 key 会让组件重新挂载、重复发起追问
  return <RecordFlow initialType={initial} today={t.toISOString()} resume={resume} />;
}

/** 刷新 /capsules/new?entry=... 时接着上次：还在追问就恢复对话，已经在收进邮局就接上进度 */
async function loadResume(id: string, direct: boolean): Promise<ResumeState | null> {
  const entry = await db.entry.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!entry) return null;
  const job = await getFinalizeStatus(id).catch((e) => {
    if (e instanceof JobRequestError && e.code === "JOB_NOT_FOUND") return null;
    throw e;
  });
  // 早先已经整理好的旧记录没有任务可接，直接去详情页
  if (!job && entry.interviewDone) redirect(`/capsules/${id}`);
  const state = interviewState(entry.messages);
  return {
    entry: {
      id,
      type: entry.type === "photo" || entry.type === "voice" ? entry.type : "text",
      text: entry.text,
      place: entry.place,
      occurredAt: entry.occurredAt.toISOString(),
      photoPath: entry.photoPath,
    },
    messages: entry.messages.map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content })),
    final: state.closed,
    canExtend: state.canExtend,
    // 「直接存入」后还没来得及开始整理就刷新了：接着整理，不进入聊天
    direct: direct && !entry.messages.length,
    job,
  };
}

export default userPage(RecordPage);

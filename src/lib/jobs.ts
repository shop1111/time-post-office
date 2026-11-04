import type { Job, Prisma } from "@prisma/client";
import { db, parseJson } from "@/lib/db";
import { embed } from "@/lib/ai/provider";
import { observeJsonExecution } from "@/lib/ai/execution";
import { withAiPurpose } from "@/lib/ai/telemetry";
import { extractEntry, persistEntry, readEntryState, savedExtraction } from "@/lib/memory/extract";
import { refreshProfile } from "@/lib/memory/profile";
import { generateStoryCard } from "@/lib/story";
import { reserveFinalize } from "@/lib/entry-work";
import { logError } from "@/lib/errors";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import type { SSEWriter } from "@/lib/server-sse";
import type { Extraction, FinalizeErrorEvent, FinalizeResult, FinalizeStage, FinalizeStageEvent, FinalizeStatusResponse, ExecutionInfo } from "@/lib/types";

export const FINALIZE_STAGES: FinalizeStage[] = ["extract", "embed", "persist", "profile", "story"];
interface Checkpoint {
  extraction?: Extraction;
  vectors?: number[][];
  persisted?: boolean;
  memoryIds?: string[];
  cardId?: string;
  executions: Partial<Record<FinalizeStage, ExecutionInfo>>;
}
interface Run {
  entryId: string;
  reused: boolean;
  state: FinalizeStatusResponse;
  checkpoint: Checkpoint;
  listeners: Set<(event: string, data: unknown) => void>;
  done: Promise<FinalizeStatusResponse>;
  settled: boolean;
}
const globals = globalThis as unknown as { finalizeRuns?: Map<string, Promise<Run>> };
const runs: Map<string, Promise<Run>> = globals.finalizeRuns ??= new Map();
export class JobRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly retryable = false) { super(message); }
}
function statusOf(job: Job): FinalizeStatusResponse {
  return {
    jobId: job.id, status: job.status as FinalizeStatusResponse["status"], currentStage: job.currentStage as FinalizeStage | null,
    stages: parseJson(job.stages, []),
    ...(job.result ? { result: parseJson<FinalizeResult | undefined>(job.result, undefined) } : {}),
    ...(job.error ? { error: parseJson<FinalizeErrorEvent | undefined>(job.error, undefined) } : {}),
  };
}
function emit(run: Run, event: string, data: unknown) { for (const listener of run.listeners) listener(event, data); }
const finished = (stage?: FinalizeStageEvent) => stage?.status === "completed" || stage?.status === "skipped";
const replaceStage = (stages: FinalizeStageEvent[], value: FinalizeStageEvent) => FINALIZE_STAGES.flatMap((name) => {
  const item = name === value.stage ? value : stages.find((s) => s.stage === name);
  return item ? [item] : [];
});
async function save(run: Run) {
  await db.job.update({ where: { id: run.state.jobId }, data: {
    status: run.state.status, currentStage: run.state.currentStage, stages: JSON.stringify(run.state.stages),
    checkpoint: JSON.stringify(run.checkpoint), result: run.state.result ? JSON.stringify(run.state.result) : null,
    error: run.state.error ? JSON.stringify(run.state.error) : null,
  } });
}

/** persist/story 在各自写入事务里调用，完成状态与结果不能分开提交。 */
async function commitStage(run: Run, stage: FinalizeStage, start: number, checkpoint: Checkpoint, tx: Prisma.TransactionClient = db) {
  const value: FinalizeStageEvent = { stage, status: "completed", durationMs: Date.now() - start, ...(checkpoint.executions[stage] ? { execution: checkpoint.executions[stage] } : {}) };
  const stages = replaceStage(run.state.stages, value);
  await tx.job.update({ where: { id: run.state.jobId }, data: { stages: JSON.stringify(stages), checkpoint: JSON.stringify(checkpoint) } });
  return stages;
}

/** 卡片可在详情页重新生成（删旧建新），结果里总是取这条记录当前的卡片，而不是任务快照里的旧 id。 */
async function currentCard(entryId: string): Promise<FinalizeResult["card"]> {
  const card = await db.storyCard.findFirst({ where: { entryId }, orderBy: { createdAt: "desc" } });
  return card ? { ...card, createdAt: card.createdAt.toISOString() } : null;
}
/** 已保存的任务结果会过时：卡片可能被重新生成，记忆可能被撤回。返回前按当前数据刷新这两项。 */
async function withCurrentState(state: FinalizeStatusResponse, entryId: string): Promise<FinalizeStatusResponse> {
  if (!state.result) return state;
  const active = new Set((await db.memory.findMany({
    where: { id: { in: state.result.memories.map((m) => m.id) }, ...ACTIVE_MEMORY }, select: { id: true },
  })).map((m) => m.id));
  return { ...state, result: { ...state.result, card: await currentCard(entryId), memories: state.result.memories.filter((m) => active.has(m.id)) } };
}

async function resultOf(run: Run): Promise<FinalizeResult> {
  const entry = await db.entry.findUniqueOrThrow({ where: { id: run.entryId } });
  const memories = await db.memory.findMany({ where: { id: { in: run.checkpoint.memoryIds ?? [] }, ...ACTIVE_MEMORY }, include: { entities: { include: { entity: true } } }, orderBy: { createdAt: "asc" } });
  return {
    extraction: run.checkpoint.extraction!,
    entry: { ...entry, occurredAt: entry.occurredAt.toISOString(), exifTime: entry.exifTime?.toISOString() ?? null, createdAt: entry.createdAt.toISOString() },
    card: await currentCard(run.entryId),
    memories: memories.map((m) => ({ id: m.id, kind: m.kind, content: m.content, importance: m.importance, dueAt: m.dueAt?.toISOString() ?? null, entities: m.entities.map(({ entity }) => ({ name: entity.name, type: entity.type })) })),
    executions: run.checkpoint.executions,
  };
}

async function execute(run: Run, ready: Promise<void>): Promise<FinalizeStatusResponse> {
  try {
    await ready;
    run.state.status = "running";
    delete run.state.error;
    delete run.state.result;
    await save(run);
    for (const stage of FINALIZE_STAGES) {
      if (finished(run.state.stages.find((s) => s.stage === stage))) continue;
      const started = Date.now();
      run.state.currentStage = stage;
      run.state.stages = replaceStage(run.state.stages, { stage, status: "started" });
      await save(run);
      emit(run, "stage", { stage, status: "started" });
      const next: Checkpoint = { ...run.checkpoint, executions: { ...run.checkpoint.executions } };
      const onExecution = (info: ExecutionInfo) => { next.executions[stage] = info; };
      try {
        let committed: FinalizeStageEvent[] | undefined;
        switch (stage) {
          case "extract": next.extraction = await extractEntry(run.entryId, { onExecution, purpose: "extract" }); break;
          case "embed": next.vectors = (await embed(next.extraction!.memories.map((m) => m.content), { onExecution, purpose: "embed" })).map((v) => Array.from(v)); break;
          case "persist":
            await persistEntry(run.entryId, next.extraction!, next.vectors!.map((v) => Float32Array.from(v)), async (tx, saved) => {
              next.extraction = saved.extraction;
              next.memoryIds = saved.memoryIds;
              next.persisted = true;
              delete next.vectors;
              committed = await commitStage(run, stage, started, next, tx);
            });
            break;
          case "profile": await withAiPurpose("profile", () => observeJsonExecution(onExecution, () => refreshProfile())); break;
          case "story":
            await generateStoryCard(run.entryId, { onExecution, purpose: "story" }, async (tx, card) => {
              next.cardId = card.id;
              committed = await commitStage(run, stage, started, next, tx);
            });
            break;
        }
        run.state.stages = committed ?? await commitStage(run, stage, started, next);
        run.checkpoint = next;
        emit(run, "stage", run.state.stages.find((s) => s.stage === stage));
        if (next.executions[stage]?.mode === "fallback") emit(run, "warning", { stage, code: next.executions[stage]!.fallbackReason ?? "AI_FALLBACK", message: "远程模型未完成，本阶段使用本地结果" });
      } catch (cause) {
        const error: FinalizeErrorEvent = { stage, code: `FINALIZE_${stage.toUpperCase()}_FAILED`, message: `处理阶段 ${stage} 失败，可重试`, retryable: true };
        run.state.stages = replaceStage(run.state.stages, { stage, status: "failed", durationMs: Date.now() - started, ...(next.executions[stage] ? { execution: next.executions[stage] } : {}) });
        run.state.error = error;
        logError(`finalize.${stage}`, cause);
        if (stage === "profile" || stage === "story") {
          await save(run);
          emit(run, "stage", run.state.stages.find((s) => s.stage === stage));
          emit(run, "warning", { stage, code: error.code, message: error.message });
        } else {
          run.state.status = "failed";
          await save(run);
          emit(run, "stage", run.state.stages.find((s) => s.stage === stage));
          return run.state;
        }
      }
    }
    run.state.result = await resultOf(run);
    run.state.status = run.state.stages.some((s) => s.status === "failed") ? "partial" : "completed";
    run.state.currentStage = null;
    if (run.state.status === "completed") delete run.state.error;
    await save(run);
  } catch (error) {
    logError("finalize", error);
    run.state.status = "failed";
    run.state.error = { ...(run.state.currentStage ? { stage: run.state.currentStage } : {}), code: "FINALIZE_FAILED", message: "收进邮局暂时失败，请重试", retryable: true };
    // 数据库不可用时不抛出未处理拒绝；重启/重试按已落库检查点继续。
    await save(run).catch((error) => logError("finalize.status", error));
  }
  return run.state;
}

function terminal(run: Run, send: (event: string, data: unknown) => void) {
  if (run.state.status === "completed" || run.state.status === "partial") send("done", { status: run.state.status, result: run.state.result });
  else send("error", run.state.error ?? { code: "FINALIZE_FAILED", message: "收进邮局失败", retryable: true });
}

async function open(entryId: string, ready: Promise<void>): Promise<Run> {
  const entry = await db.entry.findUnique({ where: { id: entryId } });
  if (!entry) throw new JobRequestError(404, "ENTRY_NOT_FOUND", "找不到这条记录");
  const previous = await db.job.findFirst({ where: { kind: "finalize", targetId: entryId }, orderBy: { createdAt: "desc" } });
  const job = previous ?? await db.job.create({ data: { kind: "finalize", targetId: entryId } });
  const run: Run = { entryId, reused: !!previous || entry.interviewDone, state: statusOf(job), checkpoint: parseJson(job.checkpoint, { executions: {} }), listeners: new Set(), done: Promise.resolve(statusOf(job)), settled: false };
  run.checkpoint.executions ??= {};
  if (job.status === "completed" && run.state.result) {
    run.state = await withCurrentState(run.state, entryId);
    run.done = Promise.resolve(run.state);
    run.settled = true;
    return run;
  }

  const saved = await readEntryState(entryId);
  // Entry 终态或 persist 完成检查点永远优先，哪怕所有记忆后来都被遗忘，也不重新生成。
  if (saved.interviewDone || saved.memories.length || run.checkpoint.persisted || finished(run.state.stages.find((s) => s.stage === "persist"))) {
    run.reused = true;
    run.checkpoint.persisted = true;
    run.checkpoint.extraction ??= savedExtraction(saved);
    run.checkpoint.memoryIds ??= saved.memories.map((m) => m.id);
    delete run.checkpoint.vectors;
    for (const stage of ["extract", "embed", "persist"] as const) {
      if (!finished(run.state.stages.find((s) => s.stage === stage))) run.state.stages = replaceStage(run.state.stages, { stage, status: "skipped", durationMs: 0 });
    }
    if (!previous) {
      const card = await db.storyCard.findFirst({ where: { entryId }, orderBy: { createdAt: "desc" } });
      if (card) { run.checkpoint.cardId = card.id; run.state.stages = replaceStage(run.state.stages, { stage: "story", status: "skipped", durationMs: 0 }); }
    }
    if (!saved.interviewDone) await db.entry.update({ where: { id: entryId }, data: { interviewDone: true } });
  }
  run.done = execute(run, ready).then((state) => { run.settled = true; terminal(run, (event, data) => emit(run, event, data)); return state; });
  return run;
}

/** 先同步注册同一 Promise，避免并发请求在第一个 await 前后各建一份任务。 */
export async function startFinalize(entryId: string) {
  const active = runs.get(entryId);
  if (active) {
    const run = await active;
    // 还在跑、或已完成：复用。刚以失败/部分完成结束：这是一次重试，不能再把旧错误发回去。
    if (!run.settled || run.state.status === "completed") return { run, reused: true };
    const current = runs.get(entryId);
    if (current && current !== active) return { run: await current, reused: true };
    runs.delete(entryId);
  }
  const reservation = reserveFinalize(entryId);
  const pending = open(entryId, reservation.wait);
  runs.set(entryId, pending);
  // 只有仍是当前任务时才释放：被重试顶替的旧任务不能清掉新任务的占用。
  const release = () => { if (runs.get(entryId) === pending) { runs.delete(entryId); reservation.release(); } };
  void pending.then((run) => run.done.then(release, release), release);
  const run = await pending;
  return { run, reused: run.reused };
}

export function subscribeFinalize(run: Run, reused: boolean, writer: SSEWriter) {
  writer.send("meta", { jobId: run.state.jobId, entryId: run.entryId, stages: FINALIZE_STAGES, reused });
  // 新连接先拿当前阶段快照，再接收增量；无需事件序号重放。
  for (const stage of run.state.stages) writer.send("stage", stage);
  if (run.settled) { terminal(run, (event, data) => writer.send(event, data)); writer.close(); return; }
  const listener = (event: string, data: unknown) => {
    writer.send(event, data);
    if (event === "done" || event === "error") writer.close();
  };
  run.listeners.add(listener);
  return () => { run.listeners.delete(listener); };
}

export async function getFinalizeStatus(entryId: string): Promise<FinalizeStatusResponse> {
  if (!await db.entry.findUnique({ where: { id: entryId }, select: { id: true } })) throw new JobRequestError(404, "ENTRY_NOT_FOUND", "找不到这条记录");
  let job = await db.job.findFirst({ where: { kind: "finalize", targetId: entryId }, orderBy: { createdAt: "desc" } });
  if (!job) throw new JobRequestError(404, "JOB_NOT_FOUND", "这条记录还没有收进邮局任务");
  if ((job.status === "running" || job.status === "queued") && !runs.has(entryId)) {
    // 进程重启不等同于浏览器断连：告知可重试，不能永远显示 running。
    // 读取后任务可能恰好完成，比较状态和版本，不能把新的 completed 覆盖为 failed。
    await db.job.updateMany({ where: { id: job.id, status: job.status, updatedAt: job.updatedAt }, data: { status: "failed", error: JSON.stringify({ code: "JOB_INTERRUPTED", message: "服务重启使任务中断，请重试以继续未完成阶段", retryable: true }) } });
    job = await db.job.findUniqueOrThrow({ where: { id: job.id } });
  }
  return withCurrentState(statusOf(job), entryId);
}

/** 删除记录时一并删除它的任务：任务检查点里有抽取结果和卡片内容，不能在记录删掉后残留。 */
export function deleteEntryJobs(entryId: string) {
  return db.job.deleteMany({ where: { kind: "finalize", targetId: entryId } });
}

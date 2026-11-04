/** 邮差引擎：候选去向与执行分支同源，单封失败不影响整轮。 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { now as clockNow } from "@/lib/clock";
import { logError } from "@/lib/errors";
import { PostmanContextChangedError } from "@/lib/letters/snapshot";
import { collectCandidates, type Snapshot } from "./triggers";
import { AlreadySentError, writeLetter } from "./writer";
import { serializePostman } from "./queue";
import type { PostmanDecision, PostmanResult, PostmanStage, PostmanStageEvent } from "@/lib/types";
export { writeLetter } from "./writer";

const MIN_GAP_HOURS = 20;
const STAGES: PostmanStage[] = ["retrieve", "generate", "check", "deliver"];
export async function buildSnapshot(now: Date): Promise<Snapshot> {
  const [entries, memories] = await Promise.all([
    db.entry.findMany({ select: { id: true, occurredAt: true, mood: true, title: true, type: true } }),
    db.memory.findMany({ where: ACTIVE_MEMORY, include: { entities: { include: { entity: true } } } }),
  ]);
  const existing = new Set(entries.filter((entry) => entry.occurredAt <= now).map((entry) => entry.id));
  const frequencies = new Map<string, { name: string; type: string; entries: Set<string> }>();
  for (const memory of memories) {
    if (!memory.entryId || !existing.has(memory.entryId)) continue;
    for (const { entity } of memory.entities) {
      const group = frequencies.get(entity.id) ?? { name: entity.name, type: entity.type, entries: new Set<string>() };
      group.entries.add(memory.entryId);
      frequencies.set(entity.id, group);
    }
  }
  return {
    now, entries,
    memories: memories.map((m) => ({ id: m.id, entryId: m.entryId, kind: m.kind, content: m.content, importance: m.importance, occurredAt: m.occurredAt, dueAt: m.dueAt, resolved: m.resolved, entities: m.entities.map((e) => e.entity.name) })),
    entityFreq: [...frequencies.values()].map((group) => ({ name: group.name, type: group.type, count: group.entries.size })),
  };
}

export type TickResult = PostmanResult;
export interface TickOptions {
  maxLetters?: number;
  ignoreGap?: boolean;
  now?: Date;
  runId?: string;
  onDecision?: (decision: PostmanDecision) => void;
  onStage?: (stage: PostmanStageEvent) => void;
}
/** 对直接调用的旧代码也保证串行；组合时钟动作应使用队列内的 tickWithinAction。 */
export function tick(opts: TickOptions = {}): Promise<TickResult> {
  const started = Date.now();
  return serializePostman(async () => ({ ...await tickWithinAction(opts), durationMs: Date.now() - started }));
}

/** 仅供已经持有邮差动作队列的调用者使用，避免嵌套排队死锁。 */
export async function tickWithinAction(opts: TickOptions = {}): Promise<TickResult> {
  const started = Date.now();
  const now = opts.now ?? await clockNow();
  const runId = opts.runId ?? randomUUID();
  const delivered = await db.$transaction(async (tx) => {
    const due = await tx.letter.findMany({ where: { deliveredAt: null, scheduledAt: { lte: now } }, select: { id: true } });
    await tx.letter.updateMany({ where: { id: { in: due.map((row) => row.id) }, deliveredAt: null }, data: { deliveredAt: now } });
    return due.map((row) => row.id);
  });
  // reset 后虚拟未来的来信不能阻止真实今天收信。
  const lastAi = await db.letter.findFirst({ where: { sender: { not: "user" }, deliveredAt: { lte: now } }, orderBy: { deliveredAt: "desc" } });
  const gapOk = opts.ignoreGap || !lastAi?.deliveredAt || now.getTime() - lastAi.deliveredAt.getTime() >= MIN_GAP_HOURS * 3_600_000;
  const candidates = collectCandidates(await buildSnapshot(now));
  const existing = new Map((await db.letter.findMany({ where: { triggerKey: { not: null } }, select: { id: true, triggerKey: true } })).map((row) => [row.triggerKey!, row.id]));
  const decisions: PostmanDecision[] = [];
  const generated: string[] = [];
  const usedTypes = new Set<string>();
  const maxLetters = Math.max(0, Math.floor(opts.maxLetters ?? 1));
  let selected = 0;
  const publish = (decision: PostmanDecision) => opts.onDecision?.({ ...decision, stages: decision.stages.map((stage) => ({ ...stage })) });

  for (const [index, candidate] of candidates.entries()) {
    const { key, type, sender, priority, reason } = candidate;
    const decision: PostmanDecision = { key, type, sender, priority: Math.round(priority * 100) / 100, rank: index + 1, outcome: "selected", reason, stages: [] };
    decisions.push(decision);
    const duplicate = existing.get(key);
    // 固定优先次序就是实际拦截顺序，每个分支同时停止执行并记录原因。
    if (duplicate) {
      decision.outcome = "deduplicated"; decision.existingLetterId = duplicate;
    } else if (!gapOk) {
      decision.outcome = "rate_limited";
    } else if (usedTypes.has(type)) {
      decision.outcome = "type_limited";
    } else if (selected >= maxLetters) {
      decision.outcome = "quota_limited";
    } else {
      selected++; usedTypes.add(type);
      publish(decision);
      const stageChanged = (stage: PostmanDecision["stages"][number]) => {
        decision.stages = STAGES.flatMap((name) => {
          const value = name === stage.name ? stage : decision.stages.find((previous) => previous.name === name);
          return value ? [value] : [];
        });
        opts.onStage?.({ key, ...stage });
      };
      try {
        const letter = await writeLetter(candidate, now, stageChanged);
        decision.outcome = "generated"; decision.letterId = letter.id;
        generated.push(letter.id); existing.set(key, letter.id);
      } catch (error) {
        if (error instanceof AlreadySentError) {
          decision.outcome = "deduplicated";
          decision.existingLetterId = error.letterId; existing.set(key, error.letterId);
        } else {
          decision.outcome = "failed";
          const failed = decision.stages.find((stage) => stage.status === "failed")?.name;
          decision.error = error instanceof PostmanContextChangedError
            ? { code: error.code, message: error.message, retryable: error.retryable }
            : { code: `POSTMAN_${(failed ?? "LETTER").toUpperCase()}_FAILED`, message: "这封信处理失败，其他信件照常继续", retryable: true };
          logError(`postman.${failed ?? "letter"}`, error);
        }
        for (const name of STAGES) if (!decision.stages.some((stage) => stage.name === name)) stageChanged({ name, status: "skipped", durationMs: 0 });
      }
    }
    publish(decision);
  }
  return {
    now: now.toISOString(), delivered, generated, runId, durationMs: Date.now() - started, decisions, totalCandidates: candidates.length,
    candidates: candidates.slice(0, 8).map(({ key, type, sender, priority, reason }) => ({ key, type, sender, priority: Math.round(priority * 100) / 100, reason })),
    skippedByRateLimit: !gapOk,
  };
}

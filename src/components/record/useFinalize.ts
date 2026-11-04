"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postSSE, SSEHttpError } from "@/lib/sse";
import type {
  FinalizeDoneEvent,
  FinalizeErrorEvent,
  FinalizeMetaEvent,
  FinalizeResult,
  FinalizeStage,
  FinalizeStageEvent,
  FinalizeStatusResponse,
} from "@/lib/types";

export type FinalizePhase = "idle" | "running" | "completed" | "partial" | "failed";
export type StageMap = Partial<Record<FinalizeStage, FinalizeStageEvent>>;

type Queued =
  | { kind: "stage"; data: FinalizeStageEvent }
  | { kind: "done"; data: FinalizeDoneEvent }
  | { kind: "error"; data: FinalizeErrorEvent };

// Mock 模式下五个阶段几毫秒就跑完。每一步至少停留这么久，让人看得清；显示的耗时始终是后端给的真实值。
const STEP_MS = 0;
const POLL_MS = 1000;
const POLL_GIVE_UP = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 收进邮局：SSE 推送阶段进度；连接断了就每秒查询任务状态，直到出结果。
 * 再次调用 start 就是重试，后端只重做失败或没做的阶段。
 */
export function useFinalize(entryId: string | null, onSettled?: () => void) {
  const [phase, setPhase] = useState<FinalizePhase>("idle");
  const [stages, setStages] = useState<StageMap>({});
  const [reused, setReused] = useState(false);
  const [result, setResult] = useState<FinalizeResult | null>(null);
  const [error, setError] = useState<FinalizeErrorEvent | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const shown = useRef<StageMap>({});
  const queue = useRef<Queued[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastStep = useRef(0);
  const ctrl = useRef<AbortController | null>(null);
  const settled = useRef(onSettled);

  useEffect(() => {
    settled.current = onSettled;
  }, [onSettled]);

  useEffect(
    () => () => {
      ctrl.current?.abort();
      clearTimeout(timer.current);
    },
    [],
  );

  const showStage = (s: FinalizeStageEvent) => {
    shown.current = { ...shown.current, [s.stage]: s };
    setStages(shown.current);
  };

  const apply = (item: Queued) => {
    if (item.kind === "stage") showStage(item.data);
    else if (item.kind === "done") {
      setResult(item.data.result);
      setPhase(item.data.status);
      setReconnecting(false);
      settled.current?.();
    } else {
      setError(item.data);
      setPhase("failed");
      setReconnecting(false);
    }
  };

  const pump = () => {
    if (timer.current !== undefined) return;
    const next = queue.current[0];
    if (!next) return;
    // 只有「完成 / 跳过 / 失败」和终态需要等；和当前显示一样的快照（重连、重试时）直接放过
    const same = next.kind === "stage" && shown.current[next.data.stage]?.status === next.data.status;
    const paced = !same && !(next.kind === "stage" && next.data.status === "started");
    const wait = paced ? Math.max(0, lastStep.current + STEP_MS - Date.now()) : 0;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      queue.current.shift();
      apply(next);
      if (next.kind === "stage" && !same) lastStep.current = Date.now();
      pump();
    }, wait);
  };

  const push = (item: Queued) => {
    queue.current.push(item);
    pump();
  };

  const poll = async (c: AbortController) => {
    setReconnecting(true);
    for (let misses = 0; !c.signal.aborted; ) {
      await sleep(POLL_MS);
      if (c.signal.aborted) return;
      try {
        const r = await fetch(`/api/entries/${entryId}/finalize`, { signal: c.signal });
        const s = (await r.json()) as FinalizeStatusResponse & { error?: string; code?: string; retryable?: boolean };
        if (!r.ok) {
          push({ kind: "error", data: { code: s.code ?? `HTTP_${r.status}`, message: typeof s.error === "string" ? s.error : "查不到这次整理的进度", retryable: true } });
          return;
        }
        misses = 0;
        for (const st of s.stages) push({ kind: "stage", data: st });
        if (s.status === "completed" || s.status === "partial") {
          if (s.result) push({ kind: "done", data: { status: s.status, result: s.result } });
          return;
        }
        if (s.status === "failed") {
          push({ kind: "error", data: s.error ?? { code: "FINALIZE_FAILED", message: "收进邮局失败了", retryable: true } });
          return;
        }
      } catch {
        if (c.signal.aborted) return;
        if (++misses >= POLL_GIVE_UP) {
          push({ kind: "error", data: { code: "NETWORK", message: "连不上邮局服务器，请检查网络后重试", retryable: true } });
          return;
        }
      }
    }
  };

  const start = useCallback(async () => {
    if (!entryId) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setPhase("running");
    setError(null);
    setReconnecting(false);
    let terminal = false;
    try {
      await postSSE(
        `/api/entries/${entryId}/finalize`,
        {},
        (event, data) => {
          if (event === "meta") setReused((data as FinalizeMetaEvent).reused);
          else if (event === "stage") push({ kind: "stage", data: data as FinalizeStageEvent });
          // warning 只是提示降级或部分失败，阶段本身的 execution 和状态已经说明了，这里不单独展示
          else if (event === "done" || event === "error") {
            terminal = true;
            push(event === "done" ? { kind: "done", data: data as FinalizeDoneEvent } : { kind: "error", data: data as FinalizeErrorEvent });
          }
        },
        { signal: c.signal, headers: { Accept: "text/event-stream" } },
      );
    } catch (e) {
      if (c.signal.aborted) return;
      if (e instanceof SSEHttpError) {
        push({ kind: "error", data: { code: e.code ?? `HTTP_${e.status}`, message: e.message, retryable: e.retryable } });
        return;
      }
    }
    // 没收到终态就断流不算成功：后台任务还在跑，改为查询状态
    if (!terminal && !c.signal.aborted) await poll(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  /** 刷新页面后接上：还在跑就重新订阅，已经结束就直接显示结果 */
  const resume = useCallback(
    (s: FinalizeStatusResponse) => {
      if (s.status === "running" || s.status === "queued") return void start();
      shown.current = Object.fromEntries(s.stages.map((st) => [st.stage, st]));
      setStages(shown.current);
      if ((s.status === "completed" || s.status === "partial") && s.result) {
        setResult(s.result);
        setPhase(s.status);
      } else {
        setError(s.error ?? { code: "FINALIZE_FAILED", message: "收进邮局失败了", retryable: true });
        setPhase("failed");
      }
    },
    [start],
  );

  return { phase, stages, reused, result, error, reconnecting, start, resume };
}

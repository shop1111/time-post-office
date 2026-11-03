"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postSSE, SSEHttpError } from "@/lib/sse";
import type {
  PostmanAction,
  PostmanDecision,
  PostmanDoneEvent,
  PostmanMetaEvent,
  PostmanResult,
  PostmanStage,
  PostmanStageEvent,
  StreamError,
} from "@/lib/types";

export type RunPhase = "waiting" | "running" | "done" | "error";
export interface PostmanRequestBody { action: Extract<PostmanAction, "forward" | "force">; days?: number }

type Queued =
  | { kind: "decision"; data: PostmanDecision }
  | { kind: "stage"; data: PostmanStageEvent }
  | { kind: "done"; data: PostmanDoneEvent }
  | { kind: "error"; data: StreamError };

const STAGES: PostmanStage[] = ["retrieve", "generate", "check", "deliver"];

// Mock 下整轮只要一两百毫秒。逐条过闸时每一步至少停这么久；显示的耗时始终是后端给的真实值。
const GAP = { filtered: 150, selected: 260, final: 220, stage: 260, done: 450 };

/** 过闸的节奏：只看「这一步是不是要让人看清」，不改变事件内容和顺序 */
function gapOf(item: Queued, known: Record<string, PostmanDecision>) {
  if (item.kind === "decision") return item.data.outcome === "selected" ? GAP.selected : known[item.data.key] ? GAP.final : GAP.filtered;
  if (item.kind === "stage") return item.data.status === "started" ? 0 : GAP.stage;
  return item.kind === "done" ? GAP.done : 0;
}

/**
 * 一次邮差动作的 SSE：meta → decision / stage → done。
 * holdMs 是过场动画的时长，第一条候选会等动画播完再出现；skip 会立刻放出所有已到的事件。
 */
export function usePostmanRun({ holdMs, instant }: { holdMs: number; instant: boolean }) {
  const [phase, setPhase] = useState<RunPhase>("waiting");
  const [meta, setMeta] = useState<PostmanMetaEvent | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const [decisions, setDecisions] = useState<Record<string, PostmanDecision>>({});
  const [result, setResult] = useState<PostmanResult | null>(null);
  const [error, setError] = useState<StreamError | null>(null);
  const [skipped, setSkipped] = useState(instant);

  const known = useRef<Record<string, PostmanDecision>>({});
  const queue = useRef<Queued[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextAt = useRef(0);
  const fast = useRef(instant);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      ctrl.current?.abort();
      clearTimeout(timer.current);
    },
    [],
  );

  const showDecision = (d: PostmanDecision) => {
    if (!known.current[d.key]) setOrder((o) => [...o, d.key]);
    known.current = { ...known.current, [d.key]: d };
    setDecisions(known.current);
  };

  const showStage = ({ key, ...info }: PostmanStageEvent) => {
    const d = known.current[key];
    if (!d) return;
    const stages = STAGES.flatMap((name) => {
      const v = name === info.name ? info : d.stages.find((x) => x.name === name);
      return v ? [v] : [];
    });
    known.current = { ...known.current, [key]: { ...d, stages } };
    setDecisions(known.current);
  };

  const apply = (item: Queued) => {
    if (item.kind === "decision") showDecision(item.data);
    else if (item.kind === "stage") showStage(item.data);
    else if (item.kind === "done") {
      // done 带着完整结果：以它为准补齐，防止漏掉任何一条去向
      for (const d of item.data.result.decisions) showDecision(d);
      setResult(item.data.result);
      setPhase("done");
    } else {
      setError(item.data);
      setPhase("error");
    }
  };

  const pump = () => {
    if (timer.current !== undefined) return;
    const next = queue.current[0];
    if (!next) return;
    const wait = fast.current ? 0 : Math.max(0, nextAt.current + gapOf(next, known.current) - Date.now());
    timer.current = setTimeout(() => {
      timer.current = undefined;
      queue.current.shift();
      apply(next);
      nextAt.current = Math.max(nextAt.current, Date.now());
      pump();
    }, wait);
  };

  const push = (item: Queued) => {
    queue.current.push(item);
    pump();
  };

  const skip = useCallback(() => {
    fast.current = true;
    setSkipped(true);
    clearTimeout(timer.current);
    timer.current = undefined;
    for (const item of queue.current.splice(0)) apply(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(
    async (body: PostmanRequestBody) => {
      const c = new AbortController();
      ctrl.current = c;
      let terminal = false;
      // 不自动重试：快进会拨时钟，重发一次就多走一段时间
      try {
        await postSSE(
          "/api/postman",
          body,
          (event, data) => {
            if (event === "meta") {
              setMeta(data as PostmanMetaEvent);
              setPhase("running");
              // 第一条候选等过场的日期滚完再出现
              nextAt.current = Date.now() + (fast.current ? 0 : holdMs);
            } else if (event === "decision") push({ kind: "decision", data: data as PostmanDecision });
            else if (event === "stage") push({ kind: "stage", data: data as PostmanStageEvent });
            else if (event === "done" || event === "error") {
              terminal = true;
              push(event === "done" ? { kind: "done", data: data as PostmanDoneEvent } : { kind: "error", data: data as StreamError });
            }
          },
          { signal: c.signal, headers: { Accept: "text/event-stream" } },
        );
      } catch (e) {
        if (c.signal.aborted) return;
        push({
          kind: "error",
          data: e instanceof SSEHttpError ? { code: e.code ?? `HTTP_${e.status}`, message: e.message, retryable: e.retryable } : { code: "NETWORK", message: "连不上邮局服务器", retryable: true },
        });
        return;
      }
      if (!terminal && !c.signal.aborted) {
        push({ kind: "error", data: { code: "STREAM_CLOSED", message: "连接断开了。邮差可能还在后台写信，稍后去信箱看看。", retryable: true } });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [holdMs],
  );

  return { phase, meta, order, decisions, result, error, skipped, start, skip };
}

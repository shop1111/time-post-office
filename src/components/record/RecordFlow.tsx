"use client";

import { DateInput } from "@/components/DateInput";
import { XiaojuImage } from "@/components/XiaojuImage";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, Mic, PenLine, Send, X, Check, RotateCcw, AlertCircle } from "lucide-react";
import { PhotoPicker, type PhotoInfo } from "./PhotoPicker";
import { VoiceRecorder } from "./VoiceRecorder";
import { RecallChips, type Recalled } from "./RecallChips";
import { FinalizeProgress, STAGE_INFO } from "./FinalizeProgress";
import { useFinalize } from "./useFinalize";
import { StoryCard } from "@/components/StoryCard";
import { ExecutionBadge } from "@/components/ExecutionBadge";
import { postSSE, SSEHttpError } from "@/lib/sse";
import { cn, fmtCN, photoUrl } from "@/lib/utils";
import { KIND_LABEL, type ExecutionInfo, type FinalizeStatusResponse, type InterviewDoneEvent, type InterviewMetaEvent, type MemoryKind, type StreamError } from "@/lib/types";
import type { RankWeights } from "@/lib/memory/rank";

type Stage = "compose" | "sending" | "interview" | "finalizing";
type Kind = "photo" | "voice" | "text";

interface Msg {
  role: "user" | "assistant";
  content: string;
  related?: Recalled[];
  weights?: RankWeights;
  execution?: ExecutionInfo;
  /** 这一轮没完成：后端不会保存它和对应的用户输入，retry 是要重发的那句话 */
  failed?: StreamError & { retry?: string };
}

/** 刷新页面后接着上次的进度：由 /capsules/new?entry=... 的服务端页面查好传进来 */
export interface ResumeState {
  entry: { id: string; type: Kind; text: string; place: string | null; occurredAt: string; photoPath: string | null };
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  job: FinalizeStatusResponse | null;
}

// 与后端追问轮数上限一致（达到上限时后端返回 INTERVIEW_LIMIT_REACHED，这里只用于刷新后的初始显示）
const MAX_ROUNDS = 3;
const BUSY_RETRIES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RoundOutcome = { kind: "done" } | { kind: "limit" } | { kind: "aborted" } | { kind: "failed"; error: StreamError };

const TABS: Array<{ k: Kind; label: string; icon: typeof Camera }> = [
  { k: "photo", label: "照片", icon: Camera },
  { k: "voice", label: "语音", icon: Mic },
  { k: "text", label: "文字", icon: PenLine },
];

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function RecordFlow({ initialType, today, resume }: { initialType: Kind; today: string; resume?: ResumeState | null }) {
  const [kind, setKind] = useState<Kind>(resume?.entry.type ?? initialType);
  const [stage, setStage] = useState<Stage>(resume ? (resume.job ? "finalizing" : "interview") : "compose");
  const [photo, setPhoto] = useState<PhotoInfo | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [text, setText] = useState(resume?.entry.text ?? "");
  const [place, setPlace] = useState(resume?.entry.place ?? "");
  const [when, setWhen] = useState(toLocalInput(new Date(resume?.entry.occurredAt ?? today)));
  const [entryId, setEntryId] = useState<string | null>(resume?.entry.id ?? null);
  const [msgs, setMsgs] = useState<Msg[]>(resume?.messages ?? []);
  const [streaming, setStreaming] = useState(false);
  const [final, setFinal] = useState(() => (resume?.messages.filter((m) => m.role === "assistant").length ?? 0) >= MAX_ROUNDS);
  const [reply, setReply] = useState("");
  const [forgotten, setForgotten] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const askCtrl = useRef<AbortController | null>(null);
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const fin = useFinalize(entryId, refresh);
  const result = fin.result;
  const photoSrc = photo?.preview ?? photoUrl(resume?.entry.photoPath);

  const sendTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(sendTimer.current);
      askCtrl.current?.abort();
    },
    [],
  );

  // 刷新后接上：放到下一拍再开始，开发模式下 effect 连跑两次也只会请求一次
  useEffect(() => {
    if (!resume) return;
    const t = setTimeout(() => {
      if (resume.job) fin.resume(resume.job);
      else if (!resume.messages.some((m) => m.role === "assistant")) ask(resume.entry.id);
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 只能选已经发生的时间
  const maxWhen = toLocalInput(new Date(today));
  useEffect(() => {
    // 相机时钟不准时，EXIF 可能晚于现在：截断到现在
    if (photo?.exifTime) setWhen(toLocalInput(photo.exifTime.getTime() > Date.now() ? new Date() : photo.exifTime));
    if (photo?.place && !place) setPlace(photo.place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo]);

  // 新版 Chrome 的 scrollIntoView 会返回 Promise，不能直接作为 effect 的返回值，否则 React 报错并整页刷新
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs, stage]);

  const canSend = kind === "photo" ? !!photo : kind === "voice" ? !!audio || text.trim().length > 0 : text.trim().length > 0;

  async function send() {
    setError("");
    setStage("sending");
    const fd = new FormData();
    fd.set("type", kind);
    fd.set("text", text);
    if (kind === "voice") fd.set("transcript", text);
    fd.set("occurredAt", new Date(when).toISOString());
    if (place) fd.set("place", place);
    if (photo) {
      fd.set("photo", photo.file);
      if (photo.exifTime) fd.set("exifTime", photo.exifTime.toISOString());
      if (photo.lat !== null) fd.set("lat", String(photo.lat));
      if (photo.lng !== null) fd.set("lng", String(photo.lng));
    }
    if (audio) fd.set("audio", new File([audio], "voice.webm", { type: audio.type }));
    const r = await fetch("/api/entries", { method: "POST", body: fd });
    const data = await r.json();
    if (!r.ok) {
      setError(data.error ?? "寄送失败");
      setStage("compose");
      return;
    }
    setEntryId(data.entry.id);
    // 记下这颗胶囊，刷新页面也能接着追问或看到整理进度
    window.history.replaceState(null, "", `/capsules/new?entry=${data.entry.id}`);
    sendTimer.current = setTimeout(() => {
      setStage("interview");
      ask(data.entry.id);
    }, 900);
  }

  const patchLast = (patch: (m: Msg) => Partial<Msg>) =>
    setMsgs((m) => {
      const c = [...m];
      c[c.length - 1] = { ...c[c.length - 1], ...patch(c[c.length - 1]) };
      return c;
    });

  /** 跑一轮追问流；另一轮还没结束（比如刚刷新页面）时稍等再试 */
  async function streamRound(id: string, message?: string): Promise<RoundOutcome> {
    for (let attempt = 0; ; attempt++) {
      const ctrl = new AbortController();
      askCtrl.current = ctrl;
      let ended: RoundOutcome | null = null;
      try {
        await postSSE(
          `/api/entries/${id}/interview`,
          { message },
          (event, data) => {
            if (event === "meta") {
              const d = data as InterviewMetaEvent;
              setFinal(d.final);
              patchLast(() => ({ related: d.related, weights: d.weights }));
            } else if (event === "delta") {
              patchLast((m) => ({ content: m.content + (data as string) }));
            } else if (event === "done") {
              const d = data as InterviewDoneEvent;
              setFinal(d.final);
              patchLast(() => ({ execution: d.execution }));
              ended = { kind: "done" };
            } else if (event === "error") {
              ended = { kind: "failed", error: data as StreamError };
            }
          },
          { signal: ctrl.signal, headers: { Accept: "text/event-stream" } },
        );
        // 没有 done 或 error 就断流，不算完成
        return ended ?? { kind: "failed", error: { code: "STREAM_CLOSED", message: "连接断开了，这一轮没有完成", retryable: true } };
      } catch (e) {
        if (ctrl.signal.aborted) return { kind: "aborted" };
        if (e instanceof SSEHttpError) {
          if (e.code === "INTERVIEW_BUSY" && attempt < BUSY_RETRIES) {
            await sleep(1000);
            continue;
          }
          if (e.code === "INTERVIEW_LIMIT_REACHED") return { kind: "limit" };
          return { kind: "failed", error: { code: e.code ?? `HTTP_${e.status}`, message: e.message, retryable: e.retryable } };
        }
        return { kind: "failed", error: { code: "NETWORK", message: "网络断了，这一轮没有完成", retryable: true } };
      }
    }
  }

  async function ask(id: string, message?: string) {
    setError("");
    setMsgs((m) => [...m, ...(message ? [{ role: "user" as const, content: message }] : []), { role: "assistant", content: "" }]);
    setStreaming(true);
    const outcome = await streamRound(id, message);
    if (outcome.kind === "aborted") return;
    setStreaming(false);
    if (outcome.kind === "limit") {
      // 后端说追问已经结束：这一轮的占位和输入都没保存，直接去收进邮局
      setMsgs((m) => m.slice(0, message ? -2 : -1));
      setFinal(true);
    } else if (outcome.kind === "failed") {
      patchLast(() => ({ failed: { ...outcome.error, retry: message } }));
    }
  }

  /** 失败的一轮后端没有保存：从界面上拿掉，避免显示一段不存在的对话 */
  const dropFailed = () =>
    setMsgs((m) => {
      const last = m[m.length - 1];
      return last?.failed ? m.slice(0, last.failed.retry ? -2 : -1) : m;
    });

  function retryRound(retry?: string) {
    if (!entryId || streaming) return;
    dropFailed();
    ask(entryId, retry);
  }

  /** 把没发成功的话放回输入框，改一改再发 */
  function editFailed(retry: string) {
    dropFailed();
    setReply(retry);
  }

  function finalize() {
    if (!entryId) return;
    askCtrl.current?.abort();
    setStreaming(false);
    dropFailed();
    setStage("finalizing");
    fin.start();
  }

  async function forget(id: string) {
    await fetch(`/api/memories/${id}`, { method: "DELETE" });
    setForgotten((s) => new Set(s).add(id));
  }

  function submitReply() {
    if (!reply.trim() || streaming || !entryId) return;
    dropFailed();
    ask(entryId, reply.trim());
    setReply("");
  }

  /* ---------- 撰写 ---------- */
  if (stage === "compose" || stage === "sending") {
    return (
      <div className="relative mx-auto max-w-2xl">
        <AnimatePresence>
          {stage === "sending" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl bg-paper/80 backdrop-blur-sm"
            >
              <motion.div initial={{ y: 0, rotate: 0 }} animate={{ y: [-4, 4, -4], rotate: [-3, 3, -3] }} transition={{ repeat: Infinity, duration: 1.2 }} className="text-6xl">
                ✉️
              </motion.div>
              <p className="mt-3 font-hand text-lg">正在放进胶囊…</p>
              {kind === "photo" && <p className="mt-1 text-xs text-ink-3">小局在仔细看你的照片</p>}
            </motion.div>
          )}
        </AnimatePresence>

        <h1 className="font-hand text-3xl">放一颗胶囊</h1>
        <p className="mt-1 text-sm text-ink-2">记下生活里的一个瞬间。放进去以后，小局会问你几个问题，帮你把那天的故事补完整。</p>
        <div className="mt-4 inline-flex rounded-full border border-line bg-card p-1">
          {TABS.map(({ k, label, icon: Icon }) => (
            <button key={k} onClick={() => setKind(k)} className={cn("flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm transition", kind === k ? "bg-stamp text-white" : "text-ink-2")}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>

        <div className="mt-5 space-y-4">
          {kind === "photo" && <PhotoPicker value={photo} onChange={setPhoto} />}
          {kind === "voice" && <VoiceRecorder onAudio={setAudio} onTranscript={setText} />}
          <textarea
            className="input min-h-[140px] resize-y font-hand text-lg leading-8"
            placeholder={kind === "photo" ? "想说点什么吗？（可选，不写小局也会问你）" : kind === "voice" ? "语音转写会出现在这里，也可以手动修改" : "发生了什么？开心的、难过的、平平无奇的，都可以。"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-ink-3">
              什么时候（只能选已经发生的时间）
              <DateInput type="datetime-local" aria-label="记录时间" className="mt-1" max={maxWhen} value={when} onChange={(e) => setWhen(e.target.value > maxWhen ? maxWhen : e.target.value)} />
            </label>
            <label className="text-xs text-ink-3">
              在哪里（可选）
              <input className="input mt-1" placeholder="例如：西湖、家里、公司楼下" value={place} onChange={(e) => setPlace(e.target.value)} />
            </label>
          </div>
          {error && <p className="text-sm text-stamp">{error}</p>}
          <div className="flex justify-end">
            <button className="btn btn-primary !px-6" disabled={!canSend || stage === "sending"} onClick={send}>
              <Send size={16} /> 放进去
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ---------- 追问 & 结果 ---------- */
  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center gap-3">
        {photoSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoSrc} alt="" className="h-14 w-14 rounded-lg object-cover" />
        )}
        <div>
          <div className="text-xs text-ink-3">{fmtCN(new Date(when))}{place ? ` · ${place}` : ""}</div>
          <h1 className="font-hand text-2xl">小局想多了解一点</h1>
        </div>
      </div>
      {text && <p className="mt-3 rounded-xl bg-paper-2 px-4 py-3 font-hand text-[17px] leading-8 text-ink-2">{text}</p>}

      <div className="mt-5 space-y-4">
        {msgs.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "assistant" && msgs[i - 1]?.role !== "assistant" && (
              <XiaojuImage scene="listen" className="mr-2 size-9 overflow-hidden rounded-xl border border-line bg-paper-2" />
            )}
            <div className="min-w-0 max-w-[85%]">
              {m.role === "assistant" && m.related && m.related.length > 0 && <RecallChips items={m.related} weights={m.weights} />}
              {(m.content || !m.failed) && (
                <div
                  className={cn(
                    "rounded-2xl px-4 py-2.5 text-[15px] leading-7",
                    m.role === "user" ? "rounded-br-sm bg-stamp text-white" : "rounded-bl-sm border border-line bg-card",
                    m.role === "assistant" && streaming && i === msgs.length - 1 && "caret",
                    m.failed && "border-dashed text-ink-2",
                  )}
                >
                  {m.content}
                </div>
              )}
              {m.execution && <ExecutionBadge info={m.execution} className="mt-1" />}
              {m.failed && (
                <div className="mt-1.5 rounded-xl border border-stamp/30 bg-stamp-soft/60 px-3 py-2 text-sm">
                  <p className="flex items-start gap-1.5 text-stamp">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    <span>
                      {m.failed.message}
                      <span className="text-ink-3">{m.content ? "（这段没写完的回答不会保存）" : ""}</span>
                    </span>
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button className="btn btn-primary !px-3 !py-1 text-xs" onClick={() => retryRound(m.failed?.retry)} disabled={streaming}>
                      <RotateCcw size={13} /> 重试这一轮
                    </button>
                    {m.failed.retry && (
                      <button className="btn btn-ghost !px-3 !py-1 text-xs" onClick={() => editFailed(m.failed!.retry!)} disabled={streaming}>
                        改一下再发
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      {stage === "interview" && (
        <div className="sticky bottom-20 mt-6 md:bottom-4">
          {final && !streaming ? (
            <motion.button initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={finalize} className="btn btn-primary w-full !py-3 text-base">
              📮 把这一天收进时光邮局
            </motion.button>
          ) : (
            <div className="card flex items-end gap-2 p-2">
              <textarea
                rows={1}
                className="max-h-32 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none"
                placeholder={streaming ? "小局正在写…" : "回答小局…"}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submitReply();
                  }
                }}
              />
              <button className="btn btn-ghost !px-3 text-xs" onClick={finalize} disabled={streaming}>
                就聊到这
              </button>
              <button className="btn btn-primary !px-3" onClick={submitReply} disabled={streaming || !reply.trim()} aria-label="发送">
                <Send size={16} />
              </button>
            </div>
          )}
        </div>
      )}

      {stage === "finalizing" && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-8 space-y-3">
          <FinalizeProgress phase={fin.phase} stages={fin.stages} reused={fin.reused} reconnecting={fin.reconnecting} />
          {fin.phase === "failed" && fin.error && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-stamp/30 bg-stamp-soft/60 px-4 py-3 text-sm">
              <AlertCircle size={16} className="shrink-0 text-stamp" />
              <p className="min-w-0 flex-1 text-stamp">
                {/* 失败的是哪一步，上面的列表已经标出来了；后端带阶段的 message 是给开发看的 */}
                {fin.error.stage ? "整理没有完成。点重试会从失败的那一步接着做，已经完成的不会重做。" : fin.error.message}
              </p>
              <button className="btn btn-primary !px-4 !py-1.5 text-sm" onClick={() => fin.start()}>
                <RotateCcw size={14} /> 重试
              </button>
            </div>
          )}
          {fin.phase === "partial" && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-sm">
              <p className="min-w-0 flex-1 text-ink-2">
                记住的事已经保存好了，但
                {STAGE_INFO.filter((s) => fin.stages[s.key]?.status === "failed")
                  .map((s) => `「${s.label}」`)
                  .join("、")}
                没完成。重试只会重做这一步，不会重复保存记忆。
              </p>
              <button className="btn btn-ghost !px-4 !py-1.5 text-sm" onClick={() => fin.start()}>
                <RotateCcw size={14} /> 重试没完成的步骤
              </button>
            </div>
          )}
        </motion.div>
      )}

      {stage === "finalizing" && result && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-6 space-y-6">
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-hand text-xl">我记住了</h2>
              <div className="flex gap-1">
                {result.extraction.emotions.map((e) => (
                  <span key={e} className="chip">
                    {e}
                  </span>
                ))}
              </div>
            </div>
            <p className="mt-1 text-xs text-ink-3">不想被记住的，点 × 就会忘掉。</p>
            <ul className="mt-3 space-y-2">
              {result.memories.map((m) => (
                <li key={m.id} className={cn("flex items-start gap-3 rounded-xl border border-line px-3 py-2 transition", forgotten.has(m.id) && "opacity-40 line-through")}>
                  <span className="mt-0.5 shrink-0 rounded bg-post-soft px-1.5 text-[11px] text-post">{KIND_LABEL[m.kind as MemoryKind]}</span>
                  <div className="flex-1 text-sm">
                    {m.content}
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
                      <span title="重要度">{"●".repeat(Math.ceil(m.importance / 2))}{"○".repeat(5 - Math.ceil(m.importance / 2))}</span>
                      {m.entities.map((e) => (
                        <span key={e.name}>#{e.name}</span>
                      ))}
                      {m.dueAt && <span className="text-gold">⏰ {fmtCN(m.dueAt, false)} 会来问你结果</span>}
                    </div>
                  </div>
                  {!forgotten.has(m.id) ? (
                    <button onClick={() => forget(m.id)} className="text-ink-3 hover:text-stamp" aria-label="忘掉这条">
                      <X size={16} />
                    </button>
                  ) : (
                    <Check size={16} className="text-ink-3" />
                  )}
                </li>
              ))}
            </ul>
          </div>

          {result.card && (
            <div>
              <h2 className="mb-3 font-hand text-xl">这一天的故事卡片</h2>
              <StoryCard exportable c={{ ...result.card, date: result.entry.occurredAt, place: result.entry.place, photoPath: result.entry.photoPath }} />
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Link href={`/capsules/${result.entry.id}`} className="btn btn-ghost">
              查看这颗胶囊
            </Link>
            <button onClick={() => window.location.assign("/capsules/new")} className="btn btn-primary">
              再寄一封
            </button>
          </div>
        </motion.div>
      )}
      <div ref={bottom} className="h-24" />
    </div>
  );
}

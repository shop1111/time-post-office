"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, Mic, PenLine, Send, Link2, X, Check } from "lucide-react";
import { PhotoPicker, type PhotoInfo } from "./PhotoPicker";
import { VoiceRecorder } from "./VoiceRecorder";
import { StoryCard } from "@/components/StoryCard";
import { postSSE } from "@/lib/sse";
import { cn, fmtCN } from "@/lib/utils";
import { KIND_LABEL, type MemoryKind } from "@/lib/types";

type Stage = "compose" | "sending" | "interview" | "finalizing" | "done";
type Kind = "photo" | "voice" | "text";

interface Related {
  id: string;
  content: string;
  date: string;
  score: number;
  entryId: string | null;
  parts: { sim: number; recency: number; importance: number; entity: number };
}
interface Msg {
  role: "user" | "assistant";
  content: string;
  related?: Related[];
}
interface Result {
  entry: { id: string; title: string; mood: number; place: string | null; occurredAt: string; photoPath: string | null };
  extraction: { emotions: string[]; mood: number };
  memories: Array<{ id: string; kind: MemoryKind; content: string; importance: number; dueAt: string | null; entities: Array<{ name: string; type: string }> }>;
  card: { title: string; narrative: string; quote: string; template: string };
}

const TABS: Array<{ k: Kind; label: string; icon: typeof Camera }> = [
  { k: "photo", label: "照片", icon: Camera },
  { k: "voice", label: "语音", icon: Mic },
  { k: "text", label: "日记", icon: PenLine },
];

function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function RecordFlow({ initialType, today }: { initialType: Kind; today: string }) {
  const [kind, setKind] = useState<Kind>(initialType);
  const [stage, setStage] = useState<Stage>("compose");
  const [photo, setPhoto] = useState<PhotoInfo | null>(null);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [text, setText] = useState("");
  const [place, setPlace] = useState("");
  const [when, setWhen] = useState(toLocalInput(new Date(today)));
  const [entryId, setEntryId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [final, setFinal] = useState(false);
  const [reply, setReply] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [forgotten, setForgotten] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (photo?.exifTime) setWhen(toLocalInput(photo.exifTime));
    if (photo?.place && !place) setPlace(photo.place);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo]);

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [msgs, stage]);

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
    setTimeout(() => {
      setStage("interview");
      ask(data.entry.id);
    }, 900);
  }

  async function ask(id: string, message?: string) {
    if (message) setMsgs((m) => [...m, { role: "user", content: message }]);
    setStreaming(true);
    setMsgs((m) => [...m, { role: "assistant", content: "" }]);
    try {
      await postSSE(`/api/entries/${id}/interview`, { message }, (event, data) => {
        if (event === "meta") {
          const d = data as { related: Related[]; final: boolean };
          setFinal(d.final);
          setMsgs((m) => {
            const c = [...m];
            c[c.length - 1] = { ...c[c.length - 1], related: d.related };
            return c;
          });
        } else if (event === "delta") {
          setMsgs((m) => {
            const c = [...m];
            c[c.length - 1] = { ...c[c.length - 1], content: c[c.length - 1].content + (data as string) };
            return c;
          });
        }
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setStreaming(false);
    }
  }

  async function finalize() {
    if (!entryId) return;
    setStage("finalizing");
    const r = await fetch(`/api/entries/${entryId}/finalize`, { method: "POST" });
    const data = await r.json();
    setResult(data);
    setStage("done");
    router.refresh();
  }

  async function forget(id: string) {
    await fetch(`/api/memories/${id}`, { method: "DELETE" });
    setForgotten((s) => new Set(s).add(id));
  }

  function submitReply() {
    if (!reply.trim() || streaming || !entryId) return;
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
              <p className="mt-3 font-hand text-lg">正在投进邮筒…</p>
              {kind === "photo" && <p className="mt-1 text-xs text-ink-3">邮差在仔细看你的照片</p>}
            </motion.div>
          )}
        </AnimatePresence>

        <h1 className="font-hand text-3xl">寄一封生活的信</h1>
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
            placeholder={kind === "photo" ? "想说点什么吗？（可选，不写邮差也会问你）" : kind === "voice" ? "语音转写会出现在这里，也可以手动修改" : "今天发生了什么？开心的、难过的、平平无奇的，都可以。"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-ink-3">
              什么时候
              <input type="datetime-local" className="input mt-1" value={when} onChange={(e) => setWhen(e.target.value)} />
            </label>
            <label className="text-xs text-ink-3">
              在哪里（可选）
              <input className="input mt-1" placeholder="例如：西湖、家里、公司楼下" value={place} onChange={(e) => setPlace(e.target.value)} />
            </label>
          </div>
          {error && <p className="text-sm text-stamp">{error}</p>}
          <div className="flex justify-end">
            <button className="btn btn-primary !px-6" disabled={!canSend || stage === "sending"} onClick={send}>
              <Send size={16} /> 寄出
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
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photo.preview} alt="" className="h-14 w-14 rounded-lg object-cover" />
        )}
        <div>
          <div className="text-xs text-ink-3">{fmtCN(new Date(when))}{place ? ` · ${place}` : ""}</div>
          <h1 className="font-hand text-2xl">邮差想多了解一点</h1>
        </div>
      </div>
      {text && <p className="mt-3 rounded-xl bg-paper-2 px-4 py-3 font-hand text-[17px] leading-8 text-ink-2">{text}</p>}

      <div className="mt-5 space-y-4">
        {msgs.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div className="max-w-[85%]">
              {m.role === "assistant" && m.related && m.related.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {m.related.map((r) => (
                    <Link
                      key={r.id}
                      href={r.entryId ? `/entry/${r.entryId}` : "/memory"}
                      target="_blank"
                      title={`检索得分 ${r.score} = 语义 ${r.parts.sim.toFixed(2)} · 新近 ${r.parts.recency.toFixed(2)} · 重要 ${r.parts.importance.toFixed(2)} · 实体 ${r.parts.entity.toFixed(2)}`}
                      className="chip !bg-post-soft !text-post hover:underline"
                    >
                      <Link2 size={11} /> 想起了 {fmtCN(r.date, false)}：{r.content.slice(0, 16)}…
                    </Link>
                  ))}
                </div>
              )}
              <div
                className={cn(
                  "rounded-2xl px-4 py-2.5 text-[15px] leading-7",
                  m.role === "user" ? "rounded-br-sm bg-stamp text-white" : "rounded-bl-sm border border-line bg-card",
                  m.role === "assistant" && streaming && i === msgs.length - 1 && "caret",
                )}
              >
                {m.content}
              </div>
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
                placeholder={streaming ? "邮差正在写…" : "回答邮差…"}
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
        <div className="mt-8 flex flex-col items-center gap-2 text-ink-2">
          <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 2.4, ease: "linear" }} className="text-4xl">
            🗂️
          </motion.div>
          <p className="font-hand text-lg">邮差正在整理记忆、写故事卡片…</p>
          <p className="text-xs text-ink-3">抽取事件 / 人物 / 地点 / 计划 → 生成向量 → 更新你的画像</p>
        </div>
      )}

      {stage === "done" && result && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-8 space-y-6">
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
                  <span className="mt-0.5 shrink-0 rounded bg-post-soft px-1.5 text-[11px] text-post">{KIND_LABEL[m.kind]}</span>
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

          <div>
            <h2 className="mb-3 font-hand text-xl">这一天的故事卡片</h2>
            <StoryCard exportable c={{ ...result.card, date: result.entry.occurredAt, place: result.entry.place, photoPath: result.entry.photoPath }} />
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href={`/entry/${result.entry.id}`} className="btn btn-ghost">
              查看这条记录
            </Link>
            <button onClick={() => window.location.assign("/record")} className="btn btn-primary">
              再寄一封
            </button>
          </div>
        </motion.div>
      )}
      <div ref={bottom} className="h-24" />
    </div>
  );
}

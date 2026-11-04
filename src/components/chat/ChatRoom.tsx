"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { AlertCircle, Package, RotateCcw, Send, Trash2 } from "lucide-react";
import { XiaojuImage } from "@/components/XiaojuImage";
import { ExecutionBadge } from "@/components/ExecutionBadge";
import { postSSE, SSEHttpError } from "@/lib/sse";
import { cn } from "@/lib/utils";
import type { ChatDoneEvent, ExecutionInfo, StreamError } from "@/lib/types";

interface Msg {
  role: "user" | "assistant";
  content: string;
  execution?: ExecutionInfo;
  /** 这一轮没完成：后端不会保存它和对应的输入，retry 是要重发的那句话 */
  failed?: StreamError & { retry: string };
}

const BUSY_RETRIES = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function greeting(name: string) {
  const h = new Date().getHours();
  const when = h < 5 ? "这么晚还没睡呀" : h < 11 ? "早" : h < 18 ? "来啦" : "晚上好";
  return `${when}，${name}。我在柜台这边，没什么事也可以坐会儿，想聊什么都行。`;
}

/** 「和小局聊聊」：胶囊之外随时的闲聊，历史存在服务端 */
export function ChatRoom({ initial, userName }: { initial: Array<{ role: "user" | "assistant"; content: string }>; userName: string }) {
  const [msgs, setMsgs] = useState<Msg[]>(initial);
  const [reply, setReply] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [hello] = useState(() => greeting(userName));
  const ctrl = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => () => ctrl.current?.abort(), []);
  // scrollIntoView 在新版 Chrome 返回 Promise，不能作为 effect 返回值
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [msgs]);

  const patchLast = (patch: (m: Msg) => Partial<Msg>) =>
    setMsgs((m) => {
      const c = [...m];
      c[c.length - 1] = { ...c[c.length - 1], ...patch(c[c.length - 1]) };
      return c;
    });

  /** 失败的一轮后端没保存：从界面上拿掉 */
  const dropFailed = () => setMsgs((m) => (m.at(-1)?.failed ? m.slice(0, -2) : m));

  async function say(message: string) {
    if (streaming) return;
    dropFailed();
    setMsgs((m) => [...m, { role: "user", content: message }, { role: "assistant", content: "" }]);
    setStreaming(true);
    let error: StreamError | null = null;
    for (let attempt = 0; ; attempt++) {
      const c = new AbortController();
      ctrl.current = c;
      let ended = false;
      try {
        await postSSE(
          "/api/chat",
          { message },
          (event, data) => {
            if (event === "delta") patchLast((m) => ({ content: m.content + (data as string) }));
            else if (event === "replace") patchLast(() => ({ content: data as string }));
            else if (event === "done") {
              ended = true;
              patchLast(() => ({ execution: (data as ChatDoneEvent).execution }));
            } else if (event === "error") {
              ended = true;
              error = data as StreamError;
            }
          },
          { signal: c.signal, headers: { Accept: "text/event-stream" } },
        );
        if (!ended) error = { code: "STREAM_CLOSED", message: "连接断开了，这句没说完", retryable: true };
      } catch (e) {
        if (c.signal.aborted) return;
        if (e instanceof SSEHttpError && e.code === "CHAT_BUSY" && attempt < BUSY_RETRIES) {
          await sleep(1000);
          continue;
        }
        error = e instanceof SSEHttpError ? { code: e.code ?? `HTTP_${e.status}`, message: e.message, retryable: e.retryable } : { code: "NETWORK", message: "网络断了，这句没发出去", retryable: true };
      }
      break;
    }
    setStreaming(false);
    if (error) patchLast(() => ({ failed: { ...(error as StreamError), retry: message } }));
  }

  function submit() {
    const text = reply.trim();
    if (!text || streaming) return;
    setReply("");
    say(text);
  }

  async function clear() {
    if (streaming || !msgs.length) return;
    if (!window.confirm("清空和小局的聊天记录？胶囊和记忆不受影响。")) return;
    const r = await fetch("/api/chat", { method: "DELETE" });
    if (r.ok) setMsgs([]);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center gap-3">
        <XiaojuImage scene="listen" className="size-14 shrink-0 overflow-hidden rounded-2xl border border-line bg-paper-2" />
        <div className="min-w-0 flex-1">
          <h1 className="font-hand text-2xl">和小局聊聊</h1>
          <p className="text-xs text-ink-3">不用放胶囊，想到什么就说什么。</p>
        </div>
        {msgs.length > 0 && (
          <button onClick={clear} disabled={streaming} className="btn btn-ghost !px-3 !py-1.5 text-xs" title="清空聊天记录">
            <Trash2 size={14} /> 清空
          </button>
        )}
      </div>

      <div className="mt-5 space-y-4">
        <Bubble role="assistant" first>
          {hello}
        </Bubble>
        {msgs.map((m, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Bubble role={m.role} first={m.role === "assistant" && msgs[i - 1]?.role !== "assistant"} caret={m.role === "assistant" && streaming && i === msgs.length - 1} dashed={!!m.failed} hidden={!m.content && !!m.failed}>
              {m.content}
            </Bubble>
            {(m.execution || m.failed) && (
              <div className="ml-11 max-w-[85%]">
                {m.execution && <ExecutionBadge info={m.execution} className="mt-1" />}
                {m.failed && (
                  <div className="mt-1.5 rounded-xl border border-stamp/30 bg-stamp-soft/60 px-3 py-2 text-sm">
                    <p className="flex items-start gap-1.5 text-stamp">
                      <AlertCircle size={15} className="mt-0.5 shrink-0" />
                      <span>{m.failed.message}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button className="btn btn-primary !px-3 !py-1 text-xs" onClick={() => say(m.failed!.retry)} disabled={streaming}>
                        <RotateCcw size={13} /> 再发一次
                      </button>
                      <button
                        className="btn btn-ghost !px-3 !py-1 text-xs"
                        onClick={() => {
                          const retry = m.failed!.retry;
                          dropFailed();
                          setReply(retry);
                        }}
                        disabled={streaming}
                      >
                        改一下再发
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        ))}
      </div>

      <div className="sticky bottom-20 mt-6 md:bottom-4">
        <div className="card flex items-end gap-2 p-2">
          <textarea
            rows={1}
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-2 text-[15px] outline-none"
            placeholder={streaming ? "小局正在写…" : "跟小局说点什么…"}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <Link href="/capsules/new" className="btn btn-ghost !px-3 text-xs" title="想把一件事好好记下来，就放一颗胶囊">
            <Package size={14} /> 放胶囊
          </Link>
          <button className="btn btn-primary !px-3" onClick={submit} disabled={streaming || !reply.trim()} aria-label="发送">
            <Send size={16} />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[11px] text-ink-3">闲聊不会整理成记忆；想让小局记住的事，放一颗胶囊。</p>
      </div>
      <div ref={bottom} className="h-24" />
    </div>
  );
}

function Bubble({ role, first, caret, dashed, hidden, children }: { role: "user" | "assistant"; first?: boolean; caret?: boolean; dashed?: boolean; hidden?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex", role === "user" ? "justify-end" : "justify-start")}>
      {role === "assistant" && (first ? <XiaojuImage scene="listen" className="mr-2 size-9 shrink-0 overflow-hidden rounded-xl border border-line bg-paper-2" /> : <span className="mr-2 w-9 shrink-0" />)}
      {!hidden && (
        <div
          className={cn(
            "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-7",
            role === "user" ? "rounded-br-sm bg-stamp text-white" : "rounded-bl-sm border border-line bg-card",
            caret && "caret",
            dashed && "border-dashed text-ink-2",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

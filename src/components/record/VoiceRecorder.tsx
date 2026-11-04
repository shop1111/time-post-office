"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";

/* Web Speech API 类型（浏览器私有前缀） */
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/**
 * 录音：MediaRecorder 保存音频 + AnalyserNode 画实时波形 + Web Speech 实时转写
 */
export function VoiceRecorder({ onAudio, onTranscript }: { onAudio: (b: Blob | null) => void; onTranscript: (text: string) => void }) {
  const [rec, setRec] = useState(false);
  const [secs, setSecs] = useState(0);
  const [srOk, setSrOk] = useState(true);
  const [interim, setInterim] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stopFns = useRef<Array<() => void>>([]);
  const finalText = useRef("");
  // 授权弹窗还没关时：挡住重复点击；期间离开页面，拿到的麦克风要马上关掉
  const starting = useRef(false);
  const alive = useRef(true);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    alive.current = true;
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setSrOk(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => {
      alive.current = false;
      stopFns.current.forEach((f) => f());
      stopFns.current = [];
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  async function start() {
    if (starting.current || rec) return;
    starting.current = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      starting.current = false;
      if (alive.current) alert("没有拿到麦克风权限，可以直接打字哦");
      return;
    }
    starting.current = false;
    if (!alive.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    try {
      record(stream);
    } catch {
      // 浏览器不支持录音格式等：释放麦克风，别让指示灯一直亮着
      stopFns.current.forEach((f) => f());
      stopFns.current = [];
      stream.getTracks().forEach((t) => t.stop());
      alert("这个浏览器没法录音，可以直接打字哦");
    }
  }

  function record(stream: MediaStream) {
    // 重录就是替换：音频换成新的，转写也从新的一段开始，不接在上一段后面
    finalText.current = "";
    const chunks: Blob[] = [];
    const mr = new MediaRecorder(stream);
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = () => {
      const blob = new Blob(chunks, { type: mr.mimeType || "audio/webm" });
      stream.getTracks().forEach((t) => t.stop());
      if (!alive.current) return;
      onAudio(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setAudioUrl(urlRef.current);
    };
    // 先登记停止方法：后面任何一步出错，外层都能把已经开起来的东西关掉
    stopFns.current = [() => mr.state !== "inactive" && mr.stop()];
    mr.start();

    // 波形
    const ctx = new AudioContext();
    stopFns.current.push(() => void ctx.close().catch(() => {}));
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const data = new Uint8Array(an.frequencyBinCount);
    let raf = 0;
    const draw = () => {
      const c = canvas.current;
      if (c) {
        const g = c.getContext("2d")!;
        const { width: W, height: H } = c;
        an.getByteTimeDomainData(data);
        g.clearRect(0, 0, W, H);
        g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--stamp") || "#c0483a";
        const bars = 48;
        for (let i = 0; i < bars; i++) {
          const v = Math.abs(data[Math.floor((i / bars) * data.length)] - 128) / 128;
          const h = Math.max(3, v * H * 2.2);
          g.fillRect(i * (W / bars) + 1, (H - h) / 2, W / bars - 3, h);
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    // 实时转写
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    let sr: SR | null = null;
    if (Ctor) {
      sr = new Ctor();
      sr.lang = "zh-CN";
      sr.continuous = true;
      sr.interimResults = true;
      sr.onresult = (e) => {
        let tmp = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) {
            finalText.current += r[0].transcript;
            onTranscript(finalText.current);
          } else tmp += r[0].transcript;
        }
        setInterim(tmp);
      };
      sr.onerror = () => setSrOk(false);
      try {
        sr.start();
      } catch {
        setSrOk(false);
      }
    }

    const timer = setInterval(() => setSecs((s) => s + 1), 1000);
    stopFns.current.push(
      () => cancelAnimationFrame(raf),
      () => sr?.stop(),
      () => clearInterval(timer),
    );
    setSecs(0);
    setRec(true);
  }

  function stop() {
    stopFns.current.forEach((f) => f());
    stopFns.current = [];
    setRec(false);
    setInterim("");
  }

  return (
    <div className="card flex flex-col items-center gap-4 p-6">
      <canvas ref={canvas} width={480} height={64} className={cn("h-16 w-full max-w-md", !rec && "opacity-30")} />
      <button
        onClick={rec ? stop : start}
        className={cn("flex h-20 w-20 items-center justify-center rounded-full text-white shadow-lg transition", rec ? "animate-pulse bg-ink" : "bg-stamp hover:scale-105")}
        aria-label={rec ? "停止录音" : "开始录音"}
      >
        {rec ? <Square size={26} /> : <Mic size={30} />}
      </button>
      <div className="text-sm text-ink-2">
        {rec ? `正在听… ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` : audioUrl ? "录好了，可以重录或直接寄出" : "点一下，像跟朋友说话一样讲讲今天"}
      </div>
      {interim && <div className="text-sm text-ink-3">{interim}</div>}
      {audioUrl && !rec && <audio src={audioUrl} controls className="h-9 w-full max-w-md" />}
      {!srOk && <p className="text-xs text-ink-3">当前浏览器不支持实时转写：录音会在寄出后由服务端转写（如已配置 ASR），也可以在下方手动补充文字。</p>}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return "--:--";
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

/**
 * 小播放器：播放/暂停、可拖动的进度条、时间。拖动依赖文件接口的 Range（206）。
 * 浏览器录的 webm 常常没有时长信息，先跳到极远处让浏览器算出时长，再回到开头。
 */
export function AudioPlayer({
  src,
  label,
  autoPlay = false,
  onEnded,
  onError,
  className,
}: {
  src: string;
  label?: string;
  autoPlay?: boolean;
  onEnded?: () => void;
  /** 音频加载或解码失败：调用方可以换别的办法（比如改用浏览器朗读） */
  onError?: () => void;
  className?: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(NaN);
  const [failed, setFailed] = useState(false);
  const probing = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const fail = () => {
    setFailed(true);
    onErrorRef.current?.();
  };

  // 卸载（停止朗读、离开页面）时主动停下，不依赖浏览器回收元素时才静音。
  // 只暂停、不清 src：开发模式下 effect 会先清理再重跑，清掉 src 就放不出来了
  useEffect(() => {
    const a = audio.current;
    return () => a?.pause();
  }, []);

  // 服务端渲染的 <audio> 可能在 React 接管前就读完了元数据，那次 loadedmetadata 事件错过了，这里补一次
  useEffect(() => {
    if ((audio.current?.readyState ?? 0) >= 1) onMeta();
  }, [src]);

  useEffect(() => {
    const a = audio.current;
    if (!a || !autoPlay) return;
    // 等朗读合成完时，点击的「用户手势」可能已经过期，被浏览器拦下就停在暂停状态，让人再点一下
    a.play().catch(() => setPlaying(false));
  }, [autoPlay, src]);

  function onMeta() {
    const a = audio.current!;
    if (Number.isFinite(a.duration)) return setDur(a.duration);
    probing.current = true;
    a.currentTime = 1e101;
  }

  function onDuration() {
    const a = audio.current!;
    if (!Number.isFinite(a.duration)) return;
    setDur(a.duration);
    if (probing.current) {
      probing.current = false;
      a.currentTime = 0;
    }
  }

  function toggle() {
    const a = audio.current!;
    if (a.paused) a.play().catch(fail);
    else a.pause();
  }

  function seek(v: number) {
    const a = audio.current!;
    a.currentTime = v;
    setCur(v);
  }

  if (failed) return <p className={cn("text-xs text-stamp", className)}>这段声音播放不了（文件可能已经不在了）</p>;

  return (
    <div className={cn("flex items-center gap-3 rounded-full border border-line bg-card px-2 py-1.5", className)}>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onLoadedMetadata={onMeta}
        onDurationChange={onDuration}
        onTimeUpdate={(e) => !probing.current && setCur(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          onEnded?.();
        }}
        onError={fail}
      />
      <button onClick={toggle} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stamp text-white" aria-label={playing ? "暂停" : "播放"}>
        {playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
      </button>
      {label && <span className="hidden shrink-0 text-xs text-ink-3 sm:inline">{label}</span>}
      <input
        type="range"
        min={0}
        max={Number.isFinite(dur) ? dur : 0}
        step={0.1}
        value={Math.min(cur, Number.isFinite(dur) ? dur : 0)}
        onChange={(e) => seek(Number(e.target.value))}
        disabled={!Number.isFinite(dur)}
        aria-label="播放进度"
        className="h-1 min-w-0 flex-1 cursor-pointer accent-[var(--stamp)]"
      />
      <span className="shrink-0 pr-2 text-[11px] text-ink-3 tabular-nums">
        {fmt(cur)} / {fmt(dur)}
      </span>
    </div>
  );
}

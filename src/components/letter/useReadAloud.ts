"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExecutionInfo } from "@/lib/types";

export type VoiceMode = "idle" | "loading" | "tts" | "browser";

// 没配置朗读服务时，这次打开网页期间不再反复请求
const TTS_OFF_KEY = "tts-not-configured";

/**
 * 朗读一封信：优先用后端 TTS（真人音色，可拖动进度），不可用时退回浏览器朗读。
 * 浏览器朗读一句一个 utterance（Chrome 长文本会被截断），读到哪句就高亮哪句；reading 是句子下标，-1 表示没在读。
 */
export function useReadAloud(letterId: string, sentences: string[]) {
  const [browserOk, setBrowserOk] = useState(false);
  const [mode, setMode] = useState<VoiceMode>("idle");
  const [reading, setReading] = useState(-1);
  const [tts, setTts] = useState<{ url: string; execution: ExecutionInfo } | null>(null);
  const [notice, setNotice] = useState("");
  const voice = useRef<SpeechSynthesisVoice | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setBrowserOk(true);
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      voice.current = voices.find((v) => v.lang === "zh-CN") ?? voices.find((v) => v.lang.startsWith("zh")) ?? null;
    };
    pick();
    window.speechSynthesis.addEventListener("voiceschanged", pick);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", pick);
      window.speechSynthesis.cancel();
      ctrl.current?.abort();
    };
  }, []);

  const speakInBrowser = useCallback(() => {
    const synth = window.speechSynthesis;
    synth.cancel();
    setMode("browser");
    const todo = sentences.map((text, i) => ({ text: text.trim(), i })).filter((s) => s.text);
    todo.forEach(({ text, i }, n) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      if (voice.current) u.voice = voice.current;
      u.rate = 0.95;
      u.onstart = () => setReading(i);
      if (n === todo.length - 1)
        u.onend = () => {
          setReading(-1);
          setMode("idle");
        };
      u.onerror = () => {
        setReading(-1);
        setMode("idle");
      };
      synth.speak(u);
    });
  }, [sentences]);

  const stop = useCallback(() => {
    ctrl.current?.abort();
    if (browserOk) window.speechSynthesis.cancel();
    setReading(-1);
    setMode("idle");
  }, [browserOk]);

  const start = useCallback(async () => {
    setNotice("");
    // 已经合成过就直接再播
    if (tts) return setMode("tts");
    let off = false;
    try {
      off = sessionStorage.getItem(TTS_OFF_KEY) === "1";
    } catch {
      /* 隐私模式下读不了也没关系，照常请求 */
    }
    if (!off) {
      setMode("loading");
      const c = new AbortController();
      ctrl.current = c;
      try {
        const r = await fetch(`/api/letters/${letterId}/speech`, { method: "POST", signal: c.signal });
        const data = await r.json();
        if (r.ok) {
          setTts({ url: data.url, execution: data.execution });
          setMode("tts");
          return;
        }
        if (data.code === "TTS_NOT_CONFIGURED") {
          try {
            sessionStorage.setItem(TTS_OFF_KEY, "1");
          } catch {
            /* 同上 */
          }
        } else setNotice(data.code === "TTS_TEXT_TOO_LONG" ? "这封信太长，改用浏览器完整朗读" : "朗读服务暂时不可用，改用浏览器朗读");
      } catch {
        if (c.signal.aborted) return;
        setNotice("朗读服务暂时连不上，改用浏览器朗读");
      }
    }
    if (browserOk) speakInBrowser();
    else {
      setMode("idle");
      setNotice("这个浏览器不支持朗读");
    }
  }, [letterId, tts, browserOk, speakInBrowser]);

  return { mode, reading, tts, notice, start, stop };
}

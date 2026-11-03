"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 浏览器朗读：一句一个 utterance（Chrome 长文本会被截断），读到哪句就高亮哪句。
 * reading 是正在读的句子下标，-1 表示没在读。
 */
export function useReadAloud(sentences: string[]) {
  const [supported, setSupported] = useState(false);
  const [reading, setReading] = useState(-1);
  const voice = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    setSupported(true);
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      voice.current = voices.find((v) => v.lang === "zh-CN") ?? voices.find((v) => v.lang.startsWith("zh")) ?? null;
    };
    pick();
    window.speechSynthesis.addEventListener("voiceschanged", pick);
    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", pick);
      window.speechSynthesis.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    window.speechSynthesis.cancel();
    setReading(-1);
  }, []);

  const start = useCallback(() => {
    const synth = window.speechSynthesis;
    synth.cancel();
    const todo = sentences.map((text, i) => ({ text: text.trim(), i })).filter((s) => s.text);
    todo.forEach(({ text, i }, n) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      if (voice.current) u.voice = voice.current;
      u.rate = 0.95;
      u.onstart = () => setReading(i);
      if (n === todo.length - 1) u.onend = () => setReading(-1);
      u.onerror = () => setReading(-1);
      synth.speak(u);
    });
  }, [sentences]);

  return { supported, reading, start, stop };
}

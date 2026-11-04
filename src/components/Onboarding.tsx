"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Logo } from "./Nav";
import { DemoButton } from "./DemoButton";

export function Onboarding() {
  const [name, setName] = useState("");
  const router = useRouter();
  async function saveName() {
    if (name.trim()) await fetch("/api/profile", { method: "PATCH", body: JSON.stringify({ name }) });
    router.push("/capsules/new");
  }
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center pt-8 text-center md:pt-16">
      <motion.div initial={{ scale: 0.6, rotate: -10, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 160 }}>
        <Logo size={72} />
      </motion.div>
      <h1 className="mt-6 font-hand text-4xl">欢迎来到时光邮局</h1>
      <p className="mt-4 text-[15px] leading-8 text-ink-2">
        把生活放进<span className="text-stamp">胶囊</span>——一张照片、一段语音、几行文字。
        <br />
        也可以<span className="text-post">写信</span>给某个瞬间帮过你的人、未来的自己，或者平行时空的自己。
        <br />
        邮局主理人小局会慢慢记住你的故事，时不时给你来信。
      </p>

      <div className="card mt-8 w-full p-5 text-left">
        <label className="text-sm text-ink-2">小局该怎么称呼你？</label>
        <div className="mt-2 flex gap-2">
          <input className="input" placeholder="你的名字或昵称" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveName()} />
          <button className="btn btn-primary" onClick={saveName}>
            放第一颗胶囊
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-2 text-sm text-ink-3">
        <span>想先看看用了半年会是什么样子？</span>
        <DemoButton label="导入示例数据" />
        <Link href="/about" className="mt-2 underline-offset-4 hover:underline">
          了解它是怎么工作的
        </Link>
      </div>
    </div>
  );
}

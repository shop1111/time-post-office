import { providerStatus } from "@/lib/ai/provider";
import { DEFAULT_WEIGHTS } from "@/lib/memory/rank";
import { ANNIVERSARY_MILESTONES } from "@/lib/postman/triggers";

const PIPE = [
  { t: "胶囊", d: "照片 · 语音 · 文字", s: "EXIF 时间/GPS → 离线逆地理编码；前端压缩；Web Speech 实时转写；视觉模型看图" },
  { t: "追问", d: "SSE 流式对话", s: "小局先检索相关旧记忆，自然地「想起」过去；3 轮后收尾" },
  { t: "抽取", d: "结构化记忆", s: "LLM + zod 校验 + 自动修复重试；事件/人物/地点/计划/心愿/喜好，带重要度与到期日" },
  { t: "记忆", d: "向量 + 实体图谱", s: "向量写入 SQLite；实体去重合并；画像与文风指纹持续演化" },
  { t: "邮件", d: "代笔回信", s: "你写给某个人 / 平行时空的自己的信 → 几小时到一天后 → 检索 → 推理 TA 知道什么 → 以 TA 的身份写信 → 越界核查 → 投递" },
  { t: "小局", d: "主动来信", s: "触发器打分 → 频控 → 检索 → 写信 → 事实自检 → 投递" },
];

export default function About() {
  const st = providerStatus();
  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <header>
        <h1 className="font-hand text-4xl">它是怎么工作的</h1>
        <p className="mt-3 text-[15px] leading-8 text-ink-2">
          时光邮局不是一个日记本，而是一个<strong>会慢慢认识你</strong>的 AI 伙伴。它把你放进来的胶囊整理成可检索的长期记忆；你写给别人的信，会由 agent 以收件人的身份代笔回信；邮局局长小局会在合适的时候主动给你写信。
        </p>
      </header>

      <section>
        <h2 className="mb-4 font-hand text-2xl">数据流水线</h2>
        <ol className="relative space-y-3 border-l-2 border-dashed border-line pl-6">
          {PIPE.map((p, i) => (
            <li key={p.t} className="card relative p-4">
              <span className="absolute -left-[38px] top-4 flex h-6 w-6 items-center justify-center rounded-full bg-stamp text-xs font-bold text-white">{i + 1}</span>
              <div className="flex items-baseline gap-2">
                <span className="font-hand text-xl">{p.t}</span>
                <span className="text-sm text-ink-3">{p.d}</span>
              </div>
              <p className="mt-1 text-sm leading-6 text-ink-2">{p.s}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h3 className="font-hand text-xl">混合记忆检索</h3>
          <p className="mt-2 rounded-lg bg-paper-2 px-3 py-2 font-mono text-xs leading-6">
            score = {DEFAULT_WEIGHTS.sim}·sim + {DEFAULT_WEIGHTS.recency}·0.5^(Δt/{DEFAULT_WEIGHTS.halfLifeDays}d)
            <br />+ {DEFAULT_WEIGHTS.importance}·importance + {DEFAULT_WEIGHTS.entity}·entity_overlap
          </p>
          <p className="mt-2 text-sm leading-6 text-ink-2">参考 Generative Agents：语义相似、时间衰减、重要度、实体重合四路加权，再用 MMR 去重保证多样性。回顾往事时切换为「怀旧权重」，弱化新近性。每次被想起都会记录 recallCount。</p>
        </div>
        <div className="card p-5">
          <h3 className="font-hand text-xl">小局什么时候来信</h3>
          <ul className="mt-2 space-y-1.5 text-sm leading-6 text-ink-2">
            <li>📅 周年回顾：{ANNIVERSARY_MILESTONES.map((m) => m.label).join(" / ")}的重要时刻</li>
            <li>🧵 惦记的事：计划/考试到期后，小局来问结果；回信即闭环</li>
            <li>🌧 情绪关怀：一周情绪均值偏低，小局来信安慰，并找回一段明亮的旧时光</li>
            <li>🏅 里程碑：胶囊数、某个人反复出现</li>
            <li>👋 随手问候：隔几天随机挑一颗最近的胶囊或一封你寄出的信来问候你</li>
          </ul>
          <p className="mt-2 text-xs text-ink-3">优先级排序 + 20 小时频控 + 去重键，避免打扰。</p>
        </div>
        <div className="card p-5">
          <h3 className="font-hand text-xl">代笔回信的真实感</h3>
          <p className="mt-2 text-sm leading-6 text-ink-2">写给某个人：先检索相关的胶囊记忆，再让模型以 TA 的身份逐条判断「TA 会不会知道」，只用 TA 知道的事和往来信件写信，最后核查有没有越界。写给平行时空的自己：只能看到分岔点之前的真实记忆，并用你的「文风指纹」保持口吻。写给未来自己的信不会被代写，到那天由真实的你收到。</p>
        </div>
        <div className="card p-5">
          <h3 className="font-hand text-xl">不编造 · 可解释 · 可控</h3>
          <p className="mt-2 text-sm leading-6 text-ink-2">每封信都标注触发原因和引用的真实记忆；引用 id 强校验，真实模型下再做一轮事实核查与改写。所有记忆可查看、修改、删除，数据可一键导出。</p>
        </div>
      </section>

      <section className="card p-5">
        <h3 className="font-hand text-xl">可插拔模型</h3>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          按角色配置（对话 / 看图 / 向量 / 语音），统一 OpenAI 兼容协议：DeepSeek、通义千问、硅基流动等均可接入；向量默认使用零依赖的本地中文 n-gram 哈希向量。任何一环失败都会优雅降级到本地实现。
        </p>
        <p className="mt-3 text-xs text-ink-3">
          当前：对话 {st.chat ?? "Mock"} · 看图 {st.vision ?? "未配置（EXIF + 文字兜底）"} · 向量 {st.embed} · 语音 {st.asr}
        </p>
      </section>

      <section className="text-xs leading-6 text-ink-3">
        技术栈：Next.js 15 (App Router) · TypeScript · Tailwind CSS 4 · Prisma + SQLite · zod · framer-motion · recharts · react-force-graph · exifr · html-to-image · vitest
      </section>
    </div>
  );
}

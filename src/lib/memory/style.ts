/**
 * 文风指纹：从用户自己写下的文字中统计口吻特征，让平行时空的你写信时像本人。
 * 纯函数，无 IO。
 */
import type { StyleFingerprint } from "@/lib/types";
import { splitSentences } from "./heuristics";

const PARTICLES = ["吧", "呀", "啦", "呢", "嘛", "哈", "哦", "噢", "咯", "耶", "哎", "嗯"];
const CATCH_CANDIDATES = ["哈哈哈", "哈哈", "真的", "其实", "反正", "算了", "绝了", "救命", "太好了", "突然", "原来", "果然", "终于", "居然", "就是说", "怎么说呢", "不管了", "慢慢来", "加油", "冲鸭", "好耶"];
/** 适合放进温柔信件里的口头禅 */
const GENTLE = ["慢慢来", "加油", "算了", "不管了", "原来", "终于"];
const STOP_BIGRAMS = new Set(["今天", "明天", "昨天", "现在", "时候", "什么", "没有", "自己", "感觉", "有点", "一直", "哈哈", "还是", "怎么", "知道", "一下", "然后", "因为", "所以", "但是", "可以"]);
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

export function computeStyle(texts: string[]): StyleFingerprint {
  const all = texts.join("\n");
  const sentences = texts.flatMap(splitSentences);
  const n = Math.max(1, sentences.length);
  const lens = sentences.map((s) => Array.from(s).length);

  const particleCount = new Map<string, number>();
  for (const s of sentences) {
    const tail = s.replace(/[。！？!?…~～\s.,，]+$/u, "");
    const last = tail.slice(-1);
    if (PARTICLES.includes(last)) particleCount.set(last, (particleCount.get(last) ?? 0) + 1);
  }

  const catchCount = CATCH_CANDIDATES.map((c) => [c, all.split(c).length - 1] as const)
    .filter(([, k]) => k >= 2)
    .sort((a, b) => b[1] - a[1]);
  // 去掉被更长口头禅包含的（哈哈 ⊂ 哈哈哈）
  const catchphrases: string[] = [];
  for (const [c] of catchCount) if (!catchphrases.some((x) => x.includes(c) || c.includes(x))) catchphrases.push(c);

  const bigram = new Map<string, number>();
  for (const seg of all.match(/[一-鿿]+/g) ?? []) {
    const cs = Array.from(seg);
    for (let i = 0; i + 1 < cs.length; i++) {
      const w = cs[i] + cs[i + 1];
      if (/[的了是我你他她这那就都也在和有着]/.test(w) || STOP_BIGRAMS.has(w)) continue;
      bigram.set(w, (bigram.get(w) ?? 0) + 1);
    }
  }
  const topWords = [...bigram.entries()].filter(([, k]) => k >= 2).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([w]) => w);

  // 代表性原句：长度适中、带情绪标点或口头禅的句子
  const samples = sentences
    .filter((s) => s.length >= 8 && s.length <= 40)
    .map((s) => ({ s, w: (/[！!~～…]/.test(s) ? 2 : 0) + catchphrases.filter((c) => s.includes(c)).length * 2 + (PARTICLES.some((p) => s.includes(p)) ? 1 : 0) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 5)
    .map((x) => x.s);

  return {
    avgSentenceLen: Math.round(lens.reduce((a, b) => a + b, 0) / n),
    exclaimRate: round(sentences.filter((s) => /[！!]/.test(s)).length / n),
    questionRate: round(sentences.filter((s) => /[？?]/.test(s)).length / n),
    ellipsisRate: round(sentences.filter((s) => /…|\.\.\./.test(s)).length / n),
    emojiRate: round((all.match(EMOJI_RE)?.length ?? 0) / n),
    particles: [...particleCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p]) => p),
    catchphrases: catchphrases.slice(0, 5),
    topWords,
    samples,
  };
}

const round = (x: number) => Math.round(x * 100) / 100;

/** 把指纹翻译成写作指令 */
export function describeStyle(s: StyleFingerprint): string {
  const parts: string[] = [];
  parts.push(`句子平均约 ${s.avgSentenceLen} 字${s.avgSentenceLen < 14 ? "，偏短促口语" : s.avgSentenceLen > 26 ? "，偏舒展细腻" : ""}`);
  if (s.particles.length) parts.push(`爱用句尾语气词「${s.particles.join("」「")}」`);
  if (s.catchphrases.length) parts.push(`口头禅：「${s.catchphrases.join("」「")}」`);
  if (s.exclaimRate > 0.2) parts.push("感叹号用得多，情绪外放");
  if (s.ellipsisRate > 0.1) parts.push("常用省略号，带点欲言又止");
  if (s.emojiRate > 0.1) parts.push("会用 emoji");
  if (s.samples.length) parts.push(`原话示例：${s.samples.slice(0, 3).map((x) => `「${x}」`).join(" ")}`);
  return parts.join("；");
}

/** Mock 模式下给文字「染上」用户口吻：句尾语气词 */
export function flavor(text: string, s: StyleFingerprint | null): string {
  const p = s?.particles[0];
  if (!p) return text;
  return text.replace(/。(?=[^。]*$)/, `${p}。`);
}

/** 找一句适合在信里「还给用户」的口头禅 */
export function gentleCatchphrase(s: StyleFingerprint | null): string | null {
  return s?.catchphrases.find((c) => GENTLE.includes(c)) ?? null;
}

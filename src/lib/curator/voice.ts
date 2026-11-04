/**
 * 「AI 腔」检测：规则打分，纯函数。
 * 用在三处：来信生成后的自检改写、追问的日志指标、离线评测（scripts/eval-curator.ts）。
 */
import { AVOID_PHRASES } from "./persona";

export interface VoiceLint {
  /** 0 = 很自然，越高越像 AI */
  score: number;
  hits: string[];
}

const PATTERNS: Array<{ label: string; re: RegExp; weight: number }> = [
  { label: "感叹号连用", re: /[!！]{2,}/g, weight: 1 },
  { label: "波浪号卖萌", re: /[~～]/g, weight: 0.5 },
  { label: "emoji", re: /\p{Extended_Pictographic}/gu, weight: 1 },
  { label: "一句里两个问题", re: /[^。！？!?\n]*[？?][^。！？!?\n]*[？?]/g, weight: 1 },
  { label: "排比式总结", re: /(不仅|不只)[^。]{2,20}(更|还)是/g, weight: 0.5 },
  { label: "自称AI", re: /(作为|我是)(一个|一名)?(AI|人工智能|语言模型|助手|机器人)/gi, weight: 3 },
  { label: "动作旁白", re: /[（(](看着|笑|叹气|轻声|微笑|停顿|摸|翻)[^（）()\n]{0,28}[）)]/g, weight: 1 },
  { label: "自我介绍腔",re: /作为(时光邮局的|邮局的|你的)?(局长|主理人|小局|朋友)/g, weight: 1.5 },
  { label: "客服腔", re: /(有什么(可以|能)帮|随时(为你|告诉我)|如有需要)/g, weight: 1.5 },
];

export function lintVoice(text: string): VoiceLint {
  const hits: string[] = [];
  let score = 0;
  for (const p of AVOID_PHRASES) {
    if (text.includes(p)) {
      hits.push(p);
      score += 1;
    }
  }
  for (const p of PATTERNS) {
    const n = text.match(p.re)?.length ?? 0;
    if (n) {
      hits.push(p.label);
      score += p.weight * n;
    }
  }
  return { score, hits };
}

/** 括号里的动作旁白：「（看着刚收进来的胶囊）」「(笑)」 */
const LEADING_DIRECTION = /^\s*[（(][^（）()\n]{1,30}[）)]\s*/;
const ACTION_DIRECTION = /[（(](看着|看了看|笑|轻笑|叹气|轻声|微笑|停顿|顿了顿|摸|翻|低头|抬头|挠)[^（）()\n]{0,28}[）)]/g;

/** 去掉动作旁白：开头的括号、或以动作开头的括号。「老局长（就是前任）」这类正常插话不动 */
export function stripStageDirections(text: string): string {
  return text.replace(LEADING_DIRECTION, "").replace(ACTION_DIRECTION, "");
}

/** 是否以问句结尾（用于统计「每句都在提问」的比例） */
export const endsWithQuestion = (text: string) => /[？?]\s*(——\s*小局)?\s*$/.test(text.trim());

/** 两段文字的字符 bigram Jaccard 相似度，用来发现「每封信都一个开头」 */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const cs = Array.from(s.replace(/\s/g, ""));
    const set = new Set<string>();
    for (let i = 0; i + 1 < cs.length; i++) set.add(cs[i] + cs[i + 1]);
    return set;
  };
  const A = grams(a);
  const B = grams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 信件的开头一句：去掉称呼行 */
export function openingLine(body: string): string {
  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  const rest = lines.filter((l, i) => !(i === 0 && /[：:]$/.test(l)));
  return (rest[0] ?? "").split(/[。！？!?]/)[0].slice(0, 30);
}

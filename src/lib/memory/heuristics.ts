/**
 * 本地规则抽取器：Mock 模式下的记忆抽取，也作为 LLM 失败时的兜底。
 * 纯函数，无 IO，便于单测。
 */
import type { EntityType, Extraction, ExtractedMemory } from "@/lib/types";

const FAMILY = ["妈妈", "爸爸", "老妈", "老爸", "外婆", "外公", "奶奶", "爷爷", "姐姐", "哥哥", "弟弟", "妹妹", "男朋友", "女朋友", "老公", "老婆", "室友", "闺蜜", "同事", "老板", "导师"];
const CITIES = ["北京", "上海", "杭州", "大理", "丽江", "成都", "重庆", "厦门", "广州", "深圳", "南京", "苏州", "西安", "青岛", "三亚", "武汉", "长沙", "昆明", "拉萨", "东京", "京都", "大阪", "首尔", "曼谷", "洱海", "西湖", "苍山", "鼓浪屿", "外滩", "千岛湖", "莫干山"];

const POS: Record<string, string> = {
  开心: "开心", 快乐: "开心", 哈哈: "开心", 幸福: "幸福", 喜欢: "喜爱", 好美: "惊艳", 惊艳: "惊艳", 感动: "感动", 温暖: "温暖",
  舒服: "放松", 放松: "放松", 满足: "满足", 期待: "期待", 惊喜: "惊喜", 治愈: "治愈", 自由: "自由", 骄傲: "自豪", 成就感: "自豪",
};
const NEG: Record<string, string> = {
  难过: "难过", 累: "疲惫", 疲惫: "疲惫", 焦虑: "焦虑", 烦: "烦躁", 失眠: "焦虑", 崩溃: "崩溃", 压力: "压力", 失落: "失落", 孤独: "孤独",
  哭: "难过", 委屈: "委屈", 迷茫: "迷茫", 生气: "生气", 害怕: "害怕", 想家: "思念", 遗憾: "遗憾", 加班: "疲惫",
};

const PLAN_RE = /(明天|后天|下周|下个?星期|下个月|周末|月底|年底|打算|准备|计划|要去|考试|面试|答辩|deadline|截止|(\d{1,2})月(\d{1,2})[日号])/i;
const GOAL_RE = /(希望|想要|目标|梦想|一定要|总有一天|以后要)/;
const PREF_RE = /(最喜欢|超爱|喜欢上|讨厌|受不了)/;
/** 记忆要脱离「当天」语境，去掉开头的相对时间词 */
const RELATIVE_DAY = /^(今天早上|今天晚上|今天|今晚|今早|刚刚|刚才|昨天|昨晚)[，,]?/;

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?\n；;])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

export function analyzeMood(text: string): { mood: number; emotions: string[] } {
  let p = 0;
  let n = 0;
  const emo = new Set<string>();
  for (const [w, label] of Object.entries(POS)) if (text.includes(w)) { p++; emo.add(label); }
  for (const [w, label] of Object.entries(NEG)) if (text.includes(w)) { n++; emo.add(label); }
  const mood = p + n === 0 ? 0.1 : Math.max(-1, Math.min(1, (p - n) / (p + n) * Math.min(1, (p + n) / 2)));
  return { mood: Math.round(mood * 100) / 100, emotions: [...emo].slice(0, 4) };
}

/** 从相对时间表述推出到期日 */
export function resolveDue(sentence: string, base: Date): Date | null {
  const d = new Date(base);
  const md = sentence.match(/(\d{1,2})月(\d{1,2})[日号]/);
  if (md) {
    const t = new Date(base.getFullYear(), Number(md[1]) - 1, Number(md[2]), 12);
    if (t.getTime() < base.getTime() - 86_400_000) t.setFullYear(t.getFullYear() + 1);
    return t;
  }
  const add = (days: number) => new Date(d.getTime() + days * 86_400_000);
  if (sentence.includes("明天")) return add(1);
  if (sentence.includes("后天")) return add(2);
  if (/下周|下个?星期/.test(sentence)) return add(7);
  if (sentence.includes("周末")) return add(((6 - d.getDay() + 7) % 7) || 7);
  if (sentence.includes("下个月") || sentence.includes("月底")) return add(30);
  if (sentence.includes("年底")) return new Date(base.getFullYear(), 11, 28, 12);
  if (PLAN_RE.test(sentence)) return add(14);
  return null;
}

export function extractHeuristic(
  input: { text: string; place?: string | null; occurredAt: Date; caption?: string | null },
  known: Array<{ name: string; type: EntityType }> = [],
): Extraction {
  const text = [input.text, input.caption].filter(Boolean).join("。");
  const sentences = splitSentences(text);
  const { mood, emotions } = analyzeMood(text);

  const people = new Set<string>();
  for (const f of FAMILY) if (text.includes(f)) people.add(f);
  for (const m of text.matchAll(/(?:和|跟|与|陪)([一-鿿]{2,3}?)(?:一起|去|在|聊|吃|逛|走|说)/g)) {
    const name = m[1];
    if (!/^(大家|朋友|他们|我们|自己|家人)$/.test(name)) people.add(name);
  }
  const places = new Set<string>();
  if (input.place) places.add(input.place);
  for (const c of CITIES) if (text.includes(c)) places.add(c);
  for (const k of known) {
    if (k.name.length >= 2 && text.includes(k.name)) (k.type === "place" ? places : k.type === "person" ? people : new Set()).add(k.name);
  }
  // 去掉被更长地名包含的短地名
  for (const p of [...places]) if ([...places].some((q) => q !== p && q.includes(p))) places.delete(p);

  const ents = [
    ...[...people].map((name) => ({ name, type: "person" as const })),
    ...[...places].map((name) => ({ name, type: "place" as const })),
  ];
  const entsIn = (s: string) => ents.filter((e) => s.includes(e.name));

  const memories: ExtractedMemory[] = [];
  const first = (sentences[0] ?? text.slice(0, 60)).replace(RELATIVE_DAY, "").replace(/^[，,]/, "");
  if (first) {
    const intensity = Math.abs(mood) * 3 + Math.min(3, text.length / 120);
    memories.push({
      kind: "event",
      content: first.slice(0, 80),
      importance: Math.max(3, Math.min(9, Math.round(4 + intensity + (places.size ? 1 : 0)))),
      entities: ents,
    });
  }
  for (const s of sentences.slice(1)) {
    if (PLAN_RE.test(s)) {
      const due = resolveDue(s, input.occurredAt);
      memories.push({ kind: "plan", content: s.slice(0, 80), importance: 7, dueDate: due ? due.toISOString().slice(0, 10) : null, entities: entsIn(s) });
    } else if (GOAL_RE.test(s)) {
      memories.push({ kind: "goal", content: s.slice(0, 80), importance: 7, entities: entsIn(s) });
    } else if (PREF_RE.test(s)) {
      memories.push({ kind: "preference", content: s.slice(0, 80), importance: 5, entities: entsIn(s) });
    }
  }
  if (sentences[0] && PLAN_RE.test(sentences[0]) && memories.length === 1) {
    const due = resolveDue(sentences[0], input.occurredAt);
    memories.push({ kind: "plan", content: sentences[0].slice(0, 80), importance: 7, dueDate: due?.toISOString().slice(0, 10) ?? null, entities: entsIn(sentences[0]) });
  }

  const placeTitle = [...places][0];
  const core = first.replace(/[。！？!?，,].*$/, "").slice(0, 14);
  return {
    title: placeTitle && !core.includes(placeTitle) ? `${placeTitle}·${core}` : core || "平凡的一天",
    summary: sentences.slice(0, 2).join("").slice(0, 120) || text.slice(0, 120),
    mood,
    emotions,
    place: placeTitle ?? null,
    memories: memories.slice(0, 6),
  };
}

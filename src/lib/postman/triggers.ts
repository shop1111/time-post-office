/**
 * 小局来信 · 触发器
 * 输入一份数据快照，输出「小局值得写一封信」的候选，按优先级排序。纯函数，便于单测。
 */
import type { TriggerType } from "@/lib/types";

const DAY = 86_400_000;

export interface Snapshot {
  now: Date;
  entries: Array<{ id: string; occurredAt: Date; mood: number | null; title: string | null; type: string }>;
  memories: Array<{ id: string; entryId: string | null; kind: string; content: string; importance: number; occurredAt: Date; dueAt: Date | null; resolved: boolean; entities: string[] }>;
  sentKeys: Set<string>;
  entityFreq: Array<{ name: string; type: string; count: number }>;
  /** 用户寄出的信（不含写给未来自己的） */
  sentLetters?: Array<{ id: string; to: string; subject: string; body: string; writtenAt: Date }>;
  /** 小局上一封信的送达时间 */
  lastCuratorAt?: Date | null;
  /** 随机数，测试里可注入；默认按日期做种子，同一天结果稳定 */
  rand?: () => number;
}

export interface LetterCandidate {
  key: string;
  type: TriggerType;
  sender: "curator";
  priority: number;
  reason: string;
  writtenAt: Date;
  anchorMemoryIds: string[];
  query: string;
  entities: string[];
}

/** 回顾节点：距今天数 */
export const ANNIVERSARY_MILESTONES: Array<{ days: number; label: string }> = [
  { days: 30, label: "一个月前" },
  { days: 90, label: "三个月前" },
  { days: 180, label: "半年前" },
  { days: 365, label: "一年前" },
];
const ANNIV_WINDOW_DAYS = 21;

export function anniversaryTriggers(s: Snapshot): LetterCandidate[] {
  const out: LetterCandidate[] = [];
  const byEntry = groupBy(s.memories.filter((m) => m.entryId), (m) => m.entryId!);
  for (const e of s.entries) {
    const mems = byEntry.get(e.id) ?? [];
    const top = Math.max(0, ...mems.map((m) => m.importance));
    if (top < 6 && e.type !== "photo") continue; // 只回顾值得回顾的
    const age = (s.now.getTime() - e.occurredAt.getTime()) / DAY;
    for (const ms of ANNIVERSARY_MILESTONES) {
      if (age < ms.days || age > ms.days + ANNIV_WINDOW_DAYS) continue;
      const key = `anniv:${e.id}:${ms.days}`;
      if (s.sentKeys.has(key)) continue;
      const anchor = [...mems].sort((a, b) => b.importance - a.importance);
      out.push({
        key,
        type: "anniversary",
        sender: "curator",
        priority: top + ms.days / 120 + (e.type === "photo" ? 1 : 0) + (e.mood ?? 0),
        reason: `${ms.label}的${e.occurredAt.getMonth() + 1}月${e.occurredAt.getDate()}日，你记录了「${e.title ?? "那一天"}」`,
        writtenAt: s.now,
        anchorMemoryIds: anchor.slice(0, 3).map((m) => m.id),
        query: anchor.map((m) => m.content).join(" ") || (e.title ?? ""),
        entities: [...new Set(anchor.flatMap((m) => m.entities))],
      });
    }
  }
  return out;
}

/** 未完结线索：计划/考试/约定到期了，小局来问一句「后来怎么样了」 */
export function openLoopTriggers(s: Snapshot): LetterCandidate[] {
  return s.memories
    .filter((m) => m.kind === "plan" && m.dueAt && !m.resolved)
    .filter((m) => {
      const over = (s.now.getTime() - m.dueAt!.getTime()) / DAY;
      return over >= 0 && over <= 30;
    })
    .filter((m) => !s.sentKeys.has(`loop:${m.id}`))
    .map((m) => ({
      key: `loop:${m.id}`,
      type: "open_loop" as const,
      sender: "curator" as const,
      priority: 9 + m.importance / 10,
      reason: `你在${m.occurredAt.getMonth() + 1}月${m.occurredAt.getDate()}日提到「${clip(m.content, 26)}」，那个日子已经到了`,
      writtenAt: s.now,
      anchorMemoryIds: [m.id],
      query: m.content,
      entities: m.entities,
    }));
}

/** 情绪低谷：最近一周至少 2 颗胶囊且平均情绪偏低 → 小局来安慰 */
export function lowMoodTriggers(s: Snapshot): LetterCandidate[] {
  const recent = s.entries.filter((e) => e.mood !== null && s.now.getTime() - e.occurredAt.getTime() <= 7 * DAY && e.occurredAt <= s.now);
  if (recent.length < 2) return [];
  const avg = recent.reduce((a, e) => a + (e.mood ?? 0), 0) / recent.length;
  if (avg > -0.25) return [];
  const week = isoWeek(s.now);
  const key = `mood:${week}`;
  if (s.sentKeys.has(key)) return [];
  const ids = new Set(recent.map((e) => e.id));
  const mems = s.memories.filter((m) => m.entryId && ids.has(m.entryId)).sort((a, b) => b.importance - a.importance);
  // 同时找一段过去的美好记忆作为「光」
  const bright = s.memories
    .filter((m) => !ids.has(m.entryId ?? "") && m.importance >= 7 && m.kind === "event")
    .sort((a, b) => b.importance - a.importance)[0];
  return [
    {
      key,
      type: "low_mood",
      sender: "curator",
      priority: 10 + Math.abs(avg) * 3,
      reason: `这一周你的记录里有些低落（情绪均值 ${avg.toFixed(2)}）`,
      writtenAt: s.now,
      anchorMemoryIds: [...mems.slice(0, 2).map((m) => m.id), ...(bright ? [bright.id] : [])],
      query: mems.map((m) => m.content).join(" "),
      entities: [...new Set(mems.flatMap((m) => m.entities))],
    },
  ];
}

/** 里程碑：记录数达标、某个人反复出现 */
export function milestoneTriggers(s: Snapshot): LetterCandidate[] {
  const out: LetterCandidate[] = [];
  const n = s.entries.filter((e) => e.occurredAt <= s.now).length;
  for (const target of [10, 30, 100, 365]) {
    const key = `count:${target}`;
    if (n >= target && !s.sentKeys.has(key)) {
      const best = [...s.memories].sort((a, b) => b.importance - a.importance).slice(0, 3);
      out.push({
        key,
        type: "milestone",
        sender: "curator",
        priority: 6 + target / 100,
        reason: `你已经在时光邮局放了 ${target} 颗胶囊`,
        writtenAt: s.now,
        anchorMemoryIds: best.map((m) => m.id),
        query: best.map((m) => m.content).join(" "),
        entities: [],
      });
      break;
    }
  }
  for (const p of s.entityFreq.filter((e) => e.type === "person" && e.count >= 4)) {
    const key = `person:${p.name}`;
    if (s.sentKeys.has(key)) continue;
    const mems = s.memories.filter((m) => m.entities.includes(p.name)).sort((a, b) => b.importance - a.importance);
    out.push({
      key,
      type: "milestone",
      sender: "curator",
      priority: 5 + p.count / 4,
      reason: `「${p.name}」已经在你的生活里出现了 ${p.count} 次`,
      writtenAt: s.now,
      anchorMemoryIds: mems.slice(0, 3).map((m) => m.id),
      query: `${p.name} ${mems.map((m) => m.content).join(" ")}`,
      entities: [p.name],
    });
  }
  return out;
}

export const GREETING_GAP_DAYS = 3;
const GREETING_CHANCE = 0.5;

/** 随手问候：距小局上一封信满 3 天，随机挑一颗最近的胶囊或一封你寄出的信，写信问候 */
export function greetingTrigger(s: Snapshot): LetterCandidate[] {
  if (s.lastCuratorAt && s.now.getTime() - s.lastCuratorAt.getTime() < GREETING_GAP_DAYS * DAY) return [];
  const rand = s.rand ?? seededRand(s.now);
  if (rand() >= GREETING_CHANCE) return [];
  const recent = (d: Date) => d <= s.now && s.now.getTime() - d.getTime() <= 14 * DAY;
  const pool: Array<{ kind: "capsule" | "letter"; id: string; reason: string; query: string; anchors: string[]; entities: string[] }> = [];
  for (const e of s.entries.filter((e) => recent(e.occurredAt))) {
    const mems = s.memories.filter((m) => m.entryId === e.id);
    pool.push({
      kind: "capsule",
      id: e.id,
      reason: `小局翻到了你${md(e.occurredAt)}放进来的胶囊「${e.title ?? "那一天"}」，想问候你一下`,
      query: mems.map((m) => m.content).join(" ") || (e.title ?? ""),
      anchors: mems.map((m) => m.id).slice(0, 2),
      entities: [...new Set(mems.flatMap((m) => m.entities))],
    });
  }
  for (const l of (s.sentLetters ?? []).filter((l) => recent(l.writtenAt))) {
    pool.push({
      kind: "letter",
      id: l.id,
      reason: `${md(l.writtenAt)}你给「${l.to}」寄了一封信《${clip(l.subject, 14)}》，小局想问问你最近好不好`,
      query: `${l.to} ${l.body.slice(0, 120)}`,
      anchors: [],
      entities: [l.to],
    });
  }
  if (!pool.length) return [];
  const pick = pool[Math.floor(rand() * pool.length) % pool.length];
  const key = `greet:${pick.kind}:${pick.id}`;
  if (s.sentKeys.has(key)) return [];
  return [
    {
      key,
      type: "greeting",
      sender: "curator",
      priority: 4,
      reason: pick.reason,
      writtenAt: s.now,
      anchorMemoryIds: pick.anchors,
      query: pick.query,
      entities: pick.entities,
    },
  ];
}

export function collectCandidates(s: Snapshot): LetterCandidate[] {
  return [...lowMoodTriggers(s), ...openLoopTriggers(s), ...anniversaryTriggers(s), ...milestoneTriggers(s), ...greetingTrigger(s)].sort((a, b) => b.priority - a.priority);
}

const md = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;

/** 按日期做种子的伪随机数（mulberry32） */
export function seededRand(d: Date): () => number {
  let a = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function groupBy<T>(arr: T[], key: (t: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of arr) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${Math.ceil(((t.getTime() - y.getTime()) / DAY + 1) / 7)}`;
}

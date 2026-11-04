/**
 * 小局的世界状态：由真实日期确定性地推出节气、季节、时段和「邮局今天的样子」。
 * - 同一天里不管聊几次，邮局里的样子都一样（按日期做种子）；换一天就变。
 * - 纯函数、零调用，追问时没有额外延迟。
 */

/** 二十四节气，21 世纪寿星公式的 C 值：day = floor(Y·0.2422 + C) − L */
const TERMS: Array<{ name: string; month: number; c: number }> = [
  { name: "小寒", month: 1, c: 5.4055 }, { name: "大寒", month: 1, c: 20.12 },
  { name: "立春", month: 2, c: 3.87 }, { name: "雨水", month: 2, c: 18.73 },
  { name: "惊蛰", month: 3, c: 5.63 }, { name: "春分", month: 3, c: 20.646 },
  { name: "清明", month: 4, c: 4.81 }, { name: "谷雨", month: 4, c: 20.1 },
  { name: "立夏", month: 5, c: 5.52 }, { name: "小满", month: 5, c: 21.04 },
  { name: "芒种", month: 6, c: 5.678 }, { name: "夏至", month: 6, c: 21.37 },
  { name: "小暑", month: 7, c: 7.108 }, { name: "大暑", month: 7, c: 22.83 },
  { name: "立秋", month: 8, c: 7.5 }, { name: "处暑", month: 8, c: 23.13 },
  { name: "白露", month: 9, c: 7.646 }, { name: "秋分", month: 9, c: 23.042 },
  { name: "寒露", month: 10, c: 8.318 }, { name: "霜降", month: 10, c: 23.438 },
  { name: "立冬", month: 11, c: 7.438 }, { name: "小雪", month: 11, c: 22.36 },
  { name: "大雪", month: 12, c: 7.18 }, { name: "冬至", month: 12, c: 21.94 },
];

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** 某年某个节气的日期（本地时区，2001-2099 年适用，个别年份可能差一天） */
export function solarTermDate(year: number, index: number): Date {
  const t = TERMS[index];
  const y = year % 100;
  // 1、2 月的节气按上一年的闰年数计算
  const leap = t.month <= 2 ? Math.floor((y - 1) / 4) : Math.floor(y / 4);
  const day = Math.floor(y * 0.2422 + t.c) - leap;
  return new Date(year, t.month - 1, day);
}

export interface TermInfo {
  /** 最近（含今天）已经到的节气 */
  current: string;
  /** 下一个节气 */
  next: string;
  daysSince: number;
  daysUntil: number;
}

export function solarTerm(now: Date): TermInfo {
  const today = startOfDay(now).getTime();
  const all = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].flatMap((y) =>
    TERMS.map((t, i) => ({ name: t.name, at: solarTermDate(y, i).getTime() })),
  );
  let idx = all.findIndex((t) => t.at > today) - 1;
  if (idx < 0) idx = 0;
  const cur = all[idx];
  const nxt = all[idx + 1];
  return { current: cur.name, next: nxt.name, daysSince: Math.round((today - cur.at) / DAY), daysUntil: Math.round((nxt.at - today) / DAY) };
}

export type Season = "spring" | "summer" | "autumn" | "winter";
const SEASON_OF: Record<string, Season> = Object.fromEntries(
  TERMS.map((t, i) => {
    // 立春起 6 个节气为春，依此类推；小寒、大寒属冬
    const k = (i - 2 + 24) % 24;
    return [t.name, (["spring", "summer", "autumn", "winter"] as const)[Math.floor(k / 6)]];
  }),
);
export const seasonOf = (term: string): Season => SEASON_OF[term] ?? "spring";

export type TimeOfDay = "清晨" | "上午" | "中午" | "下午" | "傍晚" | "夜里" | "深夜";
export function timeOfDay(now: Date): TimeOfDay {
  const h = now.getHours();
  if (h < 5) return "深夜";
  if (h < 8) return "清晨";
  if (h < 11) return "上午";
  if (h < 13) return "中午";
  if (h < 17) return "下午";
  if (h < 19) return "傍晚";
  if (h < 23) return "夜里";
  return "深夜";
}

/** 柜台玻璃瓶里的东西：随季节换 */
const VASE: Record<Season, string[]> = {
  spring: ["一枝玉兰", "几枝桃花", "一小把油菜花", "一枝刚抽芽的柳条"],
  summer: ["两朵栀子", "一枝荷叶", "几枝茉莉", "一束狗尾巴草"],
  autumn: ["一枝桂花", "几片银杏叶", "一枝芦苇", "两颗挂在枝上的柿子"],
  winter: ["一枝蜡梅", "几枝南天竹的红果", "一枝松枝", "一枝水仙"],
};

/** 邮局今天的小事：只写小局这边，不涉及用户 */
const SCENES: Record<Season, string[]> = {
  spring: [
    "门口的梧桐冒了新芽，早上扫出一小堆芽壳",
    "下了点小雨，柜台边晾着一把还在滴水的伞",
    "邮票这两天掉毛，柜台上一层橘色的毛",
    "有只燕子在屋檐下探头探脑，像是在看地方",
  ],
  summer: [
    "风扇吱呀吱呀地转，邮票摊在地砖上不肯动",
    "午后一场雷雨，门口积了一小片水",
    "窗台上放着半个西瓜，用纱布盖着",
    "蝉吵了一整天，信纸都被晒得有点卷",
  ],
  autumn: [
    "门口的梧桐开始落叶，早上扫了两遍",
    "巷子里有人在卖糖炒栗子，邮局里都是那个味道",
    "邮票总趴在窗台上晒太阳，晒完一边换另一边",
    "天黑得早了，下午五点多就开了柜台的灯",
  ],
  winter: [
    "柜台边生了小炉子，上面烤着两个橘子",
    "窗玻璃起了雾，有人在上面画了个邮筒",
    "邮票整天缩在炉子旁边，叫它也不动",
    "早上开门时门把手冰得手疼，信封都是凉的",
  ],
};

const NIGHT_SCENES = ["邮局早打烊了，只开着柜台那盏小灯", "巷子里很安静，只听见邮票打呼噜", "外面只剩路灯，档案柜的影子很长"];

const hash = (s: string) => Array.from(s).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const pick = <T,>(arr: readonly T[], seed: number) => arr[seed % arr.length];
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export interface WorldState {
  date: string;
  weekday: string;
  timeOfDay: TimeOfDay;
  term: TermInfo;
  season: Season;
  vase: string;
  scene: string;
}

export function worldState(now: Date): WorldState {
  const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const seed = hash(key);
  const term = solarTerm(now);
  const season = seasonOf(term.current);
  const tod = timeOfDay(now);
  // 同一个节气期间瓶子里的东西不变
  const vase = pick(VASE[season], hash(`${now.getFullYear()}-${term.current}`));
  const scene = tod === "夜里" || tod === "深夜" ? pick(NIGHT_SCENES, seed) : pick(SCENES[season], seed);
  return { date: `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`, weekday: `星期${WEEK[now.getDay()]}`, timeOfDay: tod, term, season, vase, scene };
}

export function termPhrase(t: TermInfo): string {
  if (t.daysSince === 0) return `今天${t.current}`;
  if (t.daysUntil <= 3) return `再过${t.daysUntil}天就${t.next}了`;
  if (t.daysSince <= 3) return `${t.current}刚过${t.daysSince}天`;
  return `${t.current}之后，离${t.next}还有${t.daysUntil}天`;
}

export function renderWorld(w: WorldState): string {
  return `现在是${w.date} ${w.weekday}${w.timeOfDay}，${termPhrase(w.term)}。
邮局这边：${w.scene}；柜台的玻璃瓶里插着${w.vase}。
（这是你自己这边的样子。想提就自然地提一句，不提也行；不要编造和这里矛盾的天气或季节。）`;
}

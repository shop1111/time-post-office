/**
 * 关系状态模型：小局和用户认识多久、来往多少、隔了多久没来，决定说话的熟悉程度。
 * 纯函数，数据由 context.ts 从数据库汇总。
 */
const DAY = 86_400_000;

export type Stage = "初识" | "熟悉" | "老友";

export interface RelationshipStats {
  /** 第一次来邮局（最早一颗胶囊或一封信的创建时间） */
  firstAt: Date | null;
  /** 上一次来邮局（最近一颗胶囊或一封信） */
  lastAt: Date | null;
  capsules: number;
  /** 用户写给小局的信 */
  lettersToCurator: number;
  /** 小局写给用户的信 */
  lettersFromCurator: number;
  /** 用户记录里常出现的人 */
  topPeople: string[];
}

export interface Relationship {
  stage: Stage;
  daysKnown: number;
  gapDays: number;
  stats: RelationshipStats;
}

export function computeRelationship(s: RelationshipStats, now: Date): Relationship {
  const daysKnown = s.firstAt ? Math.max(0, Math.floor((now.getTime() - s.firstAt.getTime()) / DAY)) : 0;
  const gapDays = s.lastAt ? Math.max(0, Math.floor((now.getTime() - s.lastAt.getTime()) / DAY)) : 0;
  // 亲近度：时间是底子，真正的来往（尤其是用户主动写信）更重要
  const closeness = daysKnown * 0.5 + s.capsules * 2 + s.lettersToCurator * 4 + s.lettersFromCurator;
  const stage: Stage = closeness >= 80 && daysKnown >= 30 ? "老友" : closeness >= 15 && (daysKnown >= 3 || s.capsules >= 5) ? "熟悉" : "初识";
  return { stage, daysKnown, gapDays, stats: s };
}

const GUIDANCE: Record<Stage, string> = {
  初识: "你们还不太熟。称呼TA的名字，礼貌但不客套；不开玩笑，不装熟，不说「老样子」「又来啦」。多听，少说自己。",
  熟悉: "已经认识一阵了。可以不带称呼直接说话，偶尔轻轻调侃一句，自然地提起以前聊过的事。",
  老友: "老朋友了。说话随意，可以只说半句，有默契；会念叨TA的老习惯，也会顺口讲讲自己这边的事。",
};

export function renderRelationship(r: Relationship, userName: string): string {
  const s = r.stats;
  const lines = [
    `你和${userName}：认识第 ${r.daysKnown + 1} 天，TA放进来 ${s.capsules} 颗胶囊，给你写过 ${s.lettersToCurator} 封信，你给TA写过 ${s.lettersFromCurator} 封。`,
    `熟悉程度：${r.stage}。${GUIDANCE[r.stage]}`,
  ];
  if (r.gapDays >= 7) lines.push(`TA上次来邮局是 ${r.gapDays} 天前，隔了挺久。可以自然地说一句好久不见，但别抱怨、别追问为什么没来。`);
  if (s.topPeople.length) lines.push(`TA常提起的人：${s.topPeople.slice(0, 4).join("、")}（提到时直接叫名字，不用解释是谁）。`);
  return lines.join("\n");
}

/**
 * 对话策略层：先决定「这一轮要做什么」，再让模型去说。
 * 取代原来写死的「一句回应 + 一个问题」：根据用户上一句的长短、情绪、投入程度、有没有反问，
 * 选出对话动作，并决定轮数（冷淡就早点收，聊得投入可以多一轮）。纯函数、零调用。
 */
import type { Stage } from "./relationship";

export type Act = "notice" | "ask" | "follow" | "answer" | "comfort" | "close" | "reopen" | "repair";

export interface TurnPlan {
  act: Act;
  final: boolean;
  /** 聊满了上限：这一句收尾之后不能再「再聊一会」 */
  last?: boolean;
  /** 回复长度区间（字）：每种动作有自己的下限，用户说得多时上限跟着抬高 */
  minChars: number;
  maxChars: number;
  instruction: string;
  /** 供调试与测试：命中的特征 */
  signals: string[];
}

/** 硬上限；默认第 3 轮收尾，聊得投入时延长到第 4 轮 */
export const MAX_ROUNDS = 4;
const SOFT_ROUNDS = 3;
/** 小局收尾后用户点「再聊一会」：可以接着聊，小局的回复总数最多到这么多轮，最后一轮小局说聊得差不多了 */
export const EXTENDED_MAX_ROUNDS = 10;
/** 用户点「再聊一会」时替TA发出的那句话 */
export const EXTEND_MESSAGE = "再聊一会儿吧";

const TERSE = /^(嗯+|哦+|噢+|喔+|啊+|好+的?|行吧?|还好吧?|还行吧?|一般吧?|没(什么|啥)了?|不知道|就这样吧?|算了|随便|也没什么|没了|没有了?|是的?|对+|嗯嗯|哈+)[。.!！~～…,，]*$/;
const WANTS_STOP = /(不想说了?|不聊了|先这样|就这样吧|没什么好说|不想讲|下次再说|改天再说|先不说了|不说了)/;
const ASKS_BACK = /(你呢|你今天|你那边|你最近|你觉得|你喜欢|你会不会|你有没有|小局你|邮票(呢|怎么样|还好))/;
const NEGATIVE = /(难过|伤心|难受|烦|心累|累死|好累|崩溃|焦虑|失眠|哭|委屈|失望|生气|孤独|压力|想家|没过|失败|分手|吵架|生病|住院|去世|走了|丢了|被骂|被批评|后悔|害怕|不开心|郁闷|丧|没考上|落榜|差.{0,2}分|白费|白准备)/;

/** 问句：问号结尾，或者以疑问词结尾；「没什么」「不怎么」这类不算 */
function isQuestion(t: string): boolean {
  if (/[？?]\s*$/.test(t)) return true;
  const x = t.replace(/[。.!！~～…\s]+$/, "");
  return /(吗|呢|嘛|为什么|怎么|咋|什么|啥)$/.test(x) && !/(没|不|也没|没有|没得)(什么|啥|怎么)$/.test(x);
}

export function userSignals(text: string | undefined) {
  const t = (text ?? "").trim();
  const len = Array.from(t).length;
  return {
    len,
    terse: !!t && (len <= 4 || TERSE.test(t)),
    wantsStop: WANTS_STOP.test(t),
    asksBack: ASKS_BACK.test(t) || (/[？?]\s*$/.test(t) && /你|小局/.test(t)),
    negative: NEGATIVE.test(t),
    rich: len >= 40,
    /** 在问问题（不管有没有「你」）：「换什么？」「为什么」 */
    question: isQuestion(t),
  };
}

// ———————————————————— 用户对小局说话方式的反馈 ————————————————————

export type Feedback = "longer" | "comfort" | "repeat" | "robotic";
const FEEDBACK: Array<[Feedback, RegExp]> = [
  ["comfort", /(安慰(一下|下)?我|为什么不安慰|不安慰我|哄哄我|哄我|关心一下我|关心我一下)/],
  ["repeat", /(说了(很多|好多|好几|那么多)(次|遍)|(你|为什么|干嘛|怎么)(一直|老是?|总是?|又)(让|叫|要|问)我|(老|总|一直|又)(是|在)?说(这|那)(句|几句|个|些)|重复|又是这句|换个说法|车轱辘|翻来覆去)/],
  ["robotic", /((好|很|太|真|像)(AI|ai|机器人|机器|假|官方|客服|模板))|不像(人|真人)|人机/],
  ["longer", /(说多点|多说点|多说一点|说多一点|多聊点|多讲点|话(好|太|真|也太|都)?少|((说话|回复|回答|你)(都|好|太|真|也太|怎么)+短)|敷衍|就这么点|只说一句|一两句就)/],
];
export function feedbackOf(text: string): Feedback | null {
  return FEEDBACK.find(([, re]) => re.test(text))?.[0] ?? null;
}

/** 问小局记得自己什么 */
const ABOUT_ME = /(记得我|我是(什么|怎样|怎么样|谁|个什么)(样的)?人?|你(了解|知道|认识)我|对我(的)?(印象|了解)|我在你(眼里|心里)|只知道这么点|你都知道我什么|你眼中的我)/;

const COMFORT = "TA现在不太好。用你自己的话把它接住：说出你看出TA不开心、你在意、心疼。TA还没说为什么，就轻轻问一句发生了什么（只问一句，不逼）；TA已经说了原因（在胶囊里或刚才的话里），就回应那件具体的事，说出那件事难在哪。不讲道理，不给建议，不要只说「我在」「坐着」「陪你」这种空话。也别替TA把事往坏处推（不要说「说明他根本没想起你」这种结论），别评判TA身边的人，更别补TA没说过的细节。";

/** 针对用户反馈的修正：不道歉、不解释，直接换做法 */
const REPAIR: Record<Feedback, string> = {
  longer: "TA嫌你话太少。别道歉，也别解释你为什么话少（不要说「柜台窄」「我嘴笨」之类），这次直接多说：接着刚才聊的事展开，讲一两件具体的事（你这边今天的细节、你的看法、你想起的事），说完整，像朋友聊天那样。",
  comfort: `TA想要你安慰TA。${COMFORT}`,
  repeat: "TA说你在重复。别自我检讨（不要说「是我嘴笨」「我换个说法」），直接换一个全新的角度接话：讲一件你还没提过的事，或者问TA一个具体的问题。前面用过的词一个都别再用。",
  robotic: "TA觉得你说话不像真人。别解释、别道歉，像一个真的朋友那样回应TA刚才在聊的事：带一点你自己的情绪和具体细节，可以有点随意。",
};

const INSTRUCTIONS: Record<Act, string> = {
  notice: "这是你第一次开口。从记录里挑一个具体的细节（一个词、一个画面）回应，说说它让你想到了什么，再问一个很好回答的小问题。不要先夸，不要总结TA的情绪。",
  ask: "接住TA刚说的一个具体细节（可以直接用TA的原话），说一句你的看法或联想（或者一段相关的旧记忆、一件你这边的事），再问一个具体的小问题（谁、在哪、那一刻）。只问一个。",
  follow: "这一轮不提问。顺着TA的话多聊两句：说说你听完的感觉、想到的事，或者讲一件你这边相关的小事，给TA留个话头。",
  answer: "TA在问你。先老老实实回答——用你自己的世界，带一两个具体的细节，像真的在讲自己的日子——再看情况把话轻轻递回给TA，也可以不递。",
  comfort: COMFORT,
  repair: "",
  close: "这是这次的最后一句，不要提问。说一个你记住的具体细节，然后自然地道别。不要说「收进时光邮局」「好好收藏」这类套话——可以说你把它放进了哪个抽屉、邮票做了什么，或者干脆简单说声晚安/回头见。",
  reopen: "TA说还想再聊一会儿。高兴地接住（半句就够，别客套），从这颗胶囊或刚才聊到的话里挑一个还没展开的地方，问一个具体的小问题。不要重复之前问过的。",
};

const WRAP_UP = "今天已经聊了挺久了，这是最后一句，不要提问。开头就要让TA知道今天聊得差不多了（比如「今天聊得差不多啦」「今天就聊到这儿吧」，用你自己的说法），再提一个你记住的具体细节，然后道别。";

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * 每种动作的基础长度区间（字）。用户说得越多，上限越高（最多 150），下限不变：
 * 用户只回「嗯」时小局也不会缩成半句话，用户讲了一大段时小局有空间好好回应。
 */
const LENGTH: Record<Act | "wrap" | "chat" | "recall", [number, number]> = {
  notice: [40, 80], ask: [35, 75], follow: [35, 75], answer: [45, 100], comfort: [40, 90],
  close: [35, 70], wrap: [40, 80], reopen: [35, 75], chat: [40, 90], repair: [60, 120], recall: [70, 140],
};
/** boost：TA说过嫌话少，整段对话都说长一点 */
export function lengthRange(act: keyof typeof LENGTH, userLen: number, boost = false): [number, number] {
  let [lo, hi] = LENGTH[act];
  if (boost && act !== "close" && act !== "wrap") [lo, hi] = [lo + 25, hi + 40];
  const cap = act === "comfort" ? 110 : 170;
  return [lo, clamp(Math.max(hi, Math.round(userLen * 1.2)), hi, cap)];
}

/** 小局世界里的「道具」：同一段对话里反复出现会显得像在背设定 */
const PROPS = ["炉子", "橘子", "邮票", "档案柜", "抽屉", "玻璃瓶", "银杏", "收发簿", "邮戳", "标签", "窗", "梧桐", "老局长", "邮包"];

/** 这段对话里小局已经提过的道具：提过的这次换别的 */
export function propsNote(prevReplies: string[]): string {
  const used = PROPS.filter((p) => prevReplies.some((r) => r.includes(p)));
  if (!used.length) return "";
  return `这段对话里你已经提过：${used.join("、")}。这次别再提它们，换一件别的事说，或者干脆不提你自己这边，只聊TA的事。`;
}

const STOP_GRAMS = new Set(["一下", "这个", "那个", "我们", "你们", "什么", "没有", "就是", "还是", "今天", "已经", "一点", "时候", "这儿", "那就", "不是", "可以", "自己", "知道", "现在", "这边", "那边", "有点", "一会", "会儿", "一个", "起来", "你的", "我的", "的时", "了一", "是不", "不会", "怎么", "这样", "那样", "觉得", "一样", "如果", "因为", "所以", "但是", "还有", "也是", "就好", "就行"]);

/**
 * 最近几句小局说过、且在两句以上都出现的短语（2-4 个字），比如「坐着」「我在」。
 * 道具单独由 propsNote 处理。
 */
export function repeatedPhrases(replies: string[]): string[] {
  const recent = replies.slice(-5);
  const inReplies = new Map<string, number>();
  for (const r of recent) {
    const grams = new Set<string>();
    for (const seg of r.match(/[一-鿿]+/g) ?? []) {
      const cs = Array.from(seg);
      for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= cs.length; i++) grams.add(cs.slice(i, i + n).join(""));
    }
    for (const g of grams) inReplies.set(g, (inReplies.get(g) ?? 0) + 1);
  }
  const hits = [...inReplies]
    .filter(([g, n]) => n >= 2 && !STOP_GRAMS.has(g) && !PROPS.some((p) => g.includes(p) || p.includes(g)))
    .map(([g]) => g)
    .sort((a, b) => b.length - a.length);
  // 「坐着」和「着坐」「坐一」这类碎片只留最长的
  const out: string[] = [];
  for (const g of hits) if (!out.some((o) => o.includes(g))) out.push(g);
  return out.slice(0, 6);
}

export interface ConversationSignals {
  /** TA在这段对话里说过嫌话少 */
  wantsLonger: boolean;
  /** 最近几句里TA说过难受 */
  recentNegative: boolean;
  /** 小局最近三句的平均长度 */
  recentReplyLen: number;
  repeated: string[];
}

export function conversationSignals(prevUser: string[], prevReplies: string[]): ConversationSignals {
  const last3 = prevReplies.slice(-3);
  return {
    wantsLonger: prevUser.slice(-8).some((u) => feedbackOf(u) === "longer"),
    recentNegative: prevUser.slice(-3).some((u) => NEGATIVE.test(u)),
    recentReplyLen: last3.length ? last3.reduce((a, r) => a + Array.from(r).length, 0) / last3.length : 0,
    repeated: repeatedPhrases(prevReplies),
  };
}

/** 根据整段对话写给模型的提醒：别重复、别惯性地说短 */
function conversationNote(conv: ConversationSignals, prevReplies: string[], minChars: number): string {
  const parts: string[] = [];
  if (conv.repeated.length) parts.push(`你最近几句反复说了：${conv.repeated.map((p) => `「${p}」`).join("")}。这次一个都别再用，换别的说法和别的事。`);
  const props = propsNote(prevReplies.slice(-4));
  if (props) parts.push(props);
  if (conv.recentReplyLen && conv.recentReplyLen < minChars) parts.push(`你前面几句都说得太短（平均约 ${Math.round(conv.recentReplyLen)} 字），听起来像在敷衍。别照着前面的长度来，这次说完整。`);
  if (conv.wantsLonger) parts.push("TA说过希望你多说一点，整段对话都记着这件事。");
  return parts.length ? `\n${parts.join("\n")}` : "";
}

/**
 * 放在上下文最后（用户这一句之后）的本轮提醒。
 * 历史里有一长串短回复时，模型会照着历史的长短和说法往下写；
 * 系统提示词离得太远压不住，最后这一条离生成位置最近，权重最高。
 */
export const turnReminder = (p: { instruction: string; minChars: number; maxChars: number }) =>
  `【这一句】${p.instruction}\n${lengthHint(p)}别照着前面几句的长短和说法写。直接说话，不要引号和括号旁白。`;

/** 写进提示词的长度要求 */
export const lengthHint = (p: { minChars: number; maxChars: number }) => `大约 ${p.minChars}-${p.maxChars} 字${p.minChars >= 60 ? "，三四句话" : "，两三句话"}。`;

export function planTurn(c: {
  round: number;
  entryText: string;
  lastUser?: string;
  /** 之前几轮小局用过的动作 */
  prevActs: Array<string | null>;
  stage?: Stage;
  /** 用户刚点了「再聊一会」 */
  extend?: boolean;
  /** 这次对话里小局之前说过的话：用来避免重复 */
  prevReplies?: string[];
  /** 这次对话里用户之前说过的话（不含这一句） */
  prevUser?: string[];
}): TurnPlan {
  const s = userSignals(c.lastUser);
  const fb = c.lastUser ? feedbackOf(c.lastUser) : null;
  const conv = conversationSignals(c.prevUser ?? [], c.prevReplies ?? []);
  const signals = [...Object.entries(s).filter(([k, v]) => k !== "len" && v).map(([k]) => k), ...(fb ? [`feedback:${fb}`] : [])];
  const asked = (a: string | null) => a === "notice" || a === "ask" || a === "reopen";
  const last2Asked = c.prevActs.length >= 2 && c.prevActs.slice(-2).every(asked);
  const lastFollowedTerse = c.prevActs.at(-1) === "follow";
  const engaged = s.rich || s.asksBack || s.question;
  // 小局收过一次尾、用户要求再聊：不再按「第 3 轮收尾」，聊到上限或用户想停为止
  const extended = c.extend || c.prevActs.includes("close");
  const last = extended && c.round >= EXTENDED_MAX_ROUNDS - 1;
  const hardStop = extended ? last : c.round >= MAX_ROUNDS - 1;

  let act: Act;
  if (c.round === 0 && !extended) {
    act = NEGATIVE.test(c.entryText) ? "comfort" : "notice";
  } else if (hardStop || s.wantsStop) {
    act = "close";
  } else if (fb) {
    // TA在说小局的说话方式：先改，不收尾
    act = "repair";
  } else if (c.extend) {
    act = "reopen";
  } else if (s.asksBack || s.question) {
    act = "answer";
  } else if (s.negative || (!extended && NEGATIVE.test(c.entryText) && !s.rich) || (conv.recentNegative && !s.rich)) {
    // 胶囊本身是难过的事、或者TA刚说过难受：继续接住，不追问细节
    act = "comfort";
  } else if (s.terse) {
    // 第一次冷淡：不追问，留白；连着冷淡：收尾
    act = lastFollowedTerse || (!extended && c.round >= SOFT_ROUNDS - 1) ? "close" : "follow";
  } else if (!extended && c.round >= SOFT_ROUNDS - 1 && !engaged) {
    act = "close";
  } else if (last2Asked) {
    act = "follow";
  } else {
    act = "ask";
  }

  const [minChars, maxChars] = lengthRange(act === "close" && last ? "wrap" : act, s.len, conv.wantsLonger || fb === "longer");
  const stageNote = c.stage === "初识" ? "" : c.stage === "老友" ? "（你们是老朋友，口气可以更随意。）" : "";
  const instruction = act === "close" && last ? WRAP_UP : act === "repair" ? REPAIR[fb!] : INSTRUCTIONS[act];
  const note = conversationNote(conv, c.prevReplies ?? [], minChars);
  return { act, final: act === "close", last: act === "close" && last, minChars, maxChars, instruction: `${instruction}${stageNote}${note}`, signals };
}

// ———————————————————— 随时闲聊 ————————————————————

export type ChatAct = "chat" | "answer" | "comfort" | "follow" | "repair" | "recall";

const CHAT_INSTRUCTIONS: Record<Exclude<ChatAct, "repair">, string> = {
  chat: "这是随时的闲聊，不是在问某颗胶囊。接住TA话里一个具体的点，说说你的看法或想到的事，像朋友那样有来有回。想问就问一个小问题，不想问就不问——别每句都提问，也别把话题硬拉回胶囊。",
  answer: INSTRUCTIONS.answer,
  comfort: COMFORT,
  follow: "TA话不多。不追问，自己多说两句：接住TA的话，再讲一件你这边相关的、具体的小事，给TA留个话头。",
  recall: "TA在问你记得TA什么、TA是什么样的人。用「你对TA的了解」和记忆里的具体事回答：说两三件你记得的事（人、地方、TA在意的事、TA的小习惯），像老朋友聊起对方那样带着感情，不要念档案、不要列清单。可以说一句你还想多知道TA什么。只说真的有的事，不要编。",
};

/** 「和小局聊聊」：没有轮数限制，按用户这一句和整段对话选动作和长度 */
export function planChat(c: { lastUser: string; prevActs: Array<string | null>; stage?: Stage; prevReplies?: string[]; prevUser?: string[] }) {
  const s = userSignals(c.lastUser);
  const fb = feedbackOf(c.lastUser);
  const conv = conversationSignals(c.prevUser ?? [], c.prevReplies ?? []);
  const lastTwoChat = c.prevActs.slice(-2).length === 2 && c.prevActs.slice(-2).every((a) => a === "chat");
  const act: ChatAct = fb
    ? "repair"
    : ABOUT_ME.test(c.lastUser)
      ? "recall"
      : s.asksBack || s.question
        ? "answer"
        : s.negative || (conv.recentNegative && !s.rich)
          ? "comfort"
          : s.terse || (lastTwoChat && !s.rich)
            ? "follow"
            : "chat";
  const [minChars, maxChars] = lengthRange(act, s.len, conv.wantsLonger || fb === "longer");
  const stageNote = c.stage === "老友" ? "（你们是老朋友，口气可以更随意。）" : "";
  const instruction = act === "repair" ? REPAIR[fb!] : CHAT_INSTRUCTIONS[act];
  return { act, minChars, maxChars, instruction: `${instruction}${stageNote}${conversationNote(conv, c.prevReplies ?? [], minChars)}` } as const;
}
export type ChatPlan = ReturnType<typeof planChat>;

// ———————————————————— 会话状态 ————————————————————

export type Msg = { role: string; content: string; act?: string | null };
/** 防御层拦下的那一轮（deflect:*）不算轮数，也不再送进模型上下文 */
const isDeflect = (m: Msg) => m.role === "assistant" && !!m.act?.startsWith("deflect");
export function modelHistory(messages: Msg[]): Msg[] {
  const out: Msg[] = [];
  for (const m of messages) {
    if (isDeflect(m)) {
      if (out.at(-1)?.role === "user") out.pop();
      continue;
    }
    out.push(m);
  }
  return out;
}
export function interviewState(messages: Msg[]) {
  const replies = messages.filter((m) => m.role === "assistant" && !isDeflect(m));
  const prevActs = replies.map((m) => m.act ?? null);
  // 收过尾又接着聊：上限变成 EXTENDED_MAX_ROUNDS
  const limit = prevActs.includes("close") ? EXTENDED_MAX_ROUNDS : MAX_ROUNDS;
  const closed = prevActs.at(-1) === "close" || replies.length >= limit;
  return { round: replies.length, closed, canExtend: closed && replies.length < EXTENDED_MAX_ROUNDS, prevActs };
}

// ———————————————————— 来信的形态 ————————————————————

export interface LetterPlan {
  shape: "短笺" | "信" | "带附言的信";
  minChars: number;
  maxChars: number;
  endWithQuestion: boolean;
  shareSelf: boolean;
  instruction: string;
}

/** 每封信形态不同，避免「称呼 + 三段 + 温柔提问 + 落款」的固定模板 */
export function planLetter(c: { type: string; stage: Stage; seed: number; userLetterLen?: number }): LetterPlan {
  const r = (n: number) => (c.seed >>> n) % 100;
  let shape: LetterPlan["shape"];
  if (c.type === "low_mood") shape = "短笺";
  else if (c.type === "open_loop") shape = "信";
  else if (c.type === "reply") shape = (c.userLetterLen ?? 0) < 80 ? "短笺" : r(1) < 30 ? "带附言的信" : "信";
  else if (c.type === "greeting") shape = r(2) < 60 ? "短笺" : "带附言的信";
  else shape = r(3) < 45 ? "带附言的信" : "信";

  const [minChars, maxChars] = shape === "短笺" ? [80, 160] : [180, 320];
  const endWithQuestion = c.type === "open_loop" || (c.type !== "low_mood" && r(4) < 40);
  const shareSelf = shape === "带附言的信" || (c.stage !== "初识" && r(5) < 50);
  const parts = [
    `这封写成「${shape}」，正文 ${minChars}-${maxChars} 字。`,
    shape === "带附言的信" ? "最后加一句「P.S.」，说一件邮局这边的小事。" : "",
    shareSelf && shape !== "带附言的信" ? "信里可以顺口提一句你自己这边的事，一句就够。" : "",
    endWithQuestion ? "结尾问TA一个具体的问题。" : "结尾不要提问，自然地停住就好，不要「期待你的回信」这种客套。",
    c.stage === "初识" ? "称呼用TA的名字加冒号。" : c.stage === "熟悉" ? "称呼可以随意些，也可以不要称呼直接开始。" : "像写给老朋友，开头可以直接说事。",
    "不要每段都一样长，不要用排比，不要在开头总结TA最近的情绪。",
  ];
  return { shape, minChars, maxChars, endWithQuestion, shareSelf, instruction: parts.filter(Boolean).join("") };
}

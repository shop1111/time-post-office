/**
 * Mock 演示模式：没有配置 API Key 时使用。
 * 不是写死的台词——会利用检索到的真实记忆、文风指纹和记录内容拼出有上下文的回复。
 */
import type { StyleFingerprint } from "@/lib/types";
import { flavor, gentleCatchphrase } from "@/lib/memory/style";

interface MemLite {
  id: string;
  content: string;
  occurredAt: Date;
}

const md = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
/** 记忆是第三人称写的，写信时换成「你」/「我」 */
const VERB_START = /^(和|跟|被|在|从|答应|报名|买|搬|回|送|心情|连续|第一次|陪|去|带|决定|最喜欢|希望|这次)/;
const toYou = (s: string) => {
  const t = s.replace(/她|TA/g, "你");
  return VERB_START.test(t) ? `你${t}` : t;
};
const toFirst = (s: string) => toYou(s).replace(/你/g, "我");
const pick = <T,>(arr: T[], seed: number) => arr[Math.abs(seed) % arr.length];
const seedOf = (s: string) => Array.from(s).reduce((a, c) => a + c.charCodeAt(0), 0);

export function mockInterview(c: {
  type: string;
  text: string;
  place?: string | null;
  round: number;
  maxRounds: number;
  lastUser?: string;
  related: MemLite[];
}): string {
  const seed = seedOf(c.text + c.round);
  const echo = c.lastUser ? summarizeEcho(c.lastUser) : "";
  if (c.round >= c.maxRounds - 1) {
    const detail = echo || (c.place ? `${c.place}的那一天` : "这一天");
    return `${echo ? `「${detail}」——` : ""}谢谢你愿意把这些讲给我听。我把${c.place ? `${c.place}的` : "今天的"}这一页好好收进时光邮局了，等哪天你想回来看看，它会一直在这里等你。`;
  }
  const rel = c.related[0];
  if (c.round === 0) {
    const opener =
      c.type === "photo"
        ? pick(["这张照片的光线好温柔。", "光看照片就觉得那天很值得被记住。", "这一帧拍得真好，像电影里的画面。"], seed)
        : c.type === "voice"
          ? pick(["听你的声音，能感觉到那天的情绪。", "谢谢你愿意说给我听。"], seed)
          : pick(["读完有点被触动。", "这段文字里有好多细节。"], seed);
    const recall = rel ? `这让我想起${md(rel.occurredAt)}你说过「${rel.content.slice(0, 22)}」。` : "";
    const q =
      c.type === "photo"
        ? pick(["那天是和谁一起？按下快门的那一刻在想什么？", "照片外面发生了什么？是谁陪着你？"], seed)
        : pick(["那一刻你身边有谁？", "这件事里，让你印象最深的是哪个瞬间？"], seed);
    return `${opener}${recall}${q}`;
  }
  const q = pick(
    ["如果给那一天打个分，你会打几分？为什么？", "这件事对现在的你来说，意味着什么？", "有没有一个小细节，是你特别不想忘掉的？"],
    seed,
  );
  return `${echo ? `原来是这样，${echo}，难怪你会记住。` : "嗯，我记下了。"}${q}`;
}

function summarizeEcho(s: string) {
  const first = s.split(/[，。！？,.!?\n]/).find((x) => x.trim().length >= 3)?.trim() ?? "";
  return first.slice(0, 18);
}

/** 信件正文去掉开头的称呼和结尾的落款，再取第一句有内容的话 */
export function letterEcho(body: string) {
  const lines = body
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const rest = lines.filter((l, i) => !(i === 0 && /[：:]$/.test(l)) && !/^[—-]{1,2}/.test(l));
  return summarizeEcho(rest.join("\n"));
}

/** 小局来信：问候 / 安慰 / 回顾 / 回复用户写给小局的信 */
export function mockCuratorLetter(c: {
  type: string;
  reason: string;
  memories: MemLite[];
  style: StyleFingerprint | null;
  name: string;
  today: Date;
  userLetter?: string;
}): { subject: string; body: string; cited: string[] } {
  const ms = c.memories.slice(0, 4);
  const [a, b] = ms;
  const cited = ms.slice(0, 3).map((m) => m.id);
  const sign = "—— 小局";
  if (c.userLetter) {
    const echo = letterEcho(c.userLetter);
    const body = [
      `${c.name}，你的信我收到了：`,
      `${echo ? `读到「${echo}」那一句，我在邮局的窗边停了好一会儿。` : "你的信我读了两遍。"}${a ? `这让我想起${md(a.occurredAt)}你放进来的那颗胶囊：${toYou(a.content)}。` : ""}`,
      `谢谢你愿意写信给我。你写下的这些，我都会好好收着。`,
      `最近还有什么想告诉我的吗？开心的、烦心的，都可以。`,
      sign,
    ].join("\n\n");
    return { subject: "你的信，我收到了", body, cited: a ? [a.id] : [] };
  }
  if (c.type === "low_mood") {
    const bright = ms.slice(1).find((m) => m.occurredAt.getTime() < (a?.occurredAt.getTime() ?? 0) - 7 * 86_400_000) ?? b;
    const body = [
      `亲爱的${c.name}：`,
      `这几天你放进来的胶囊，我都看到了${a ? `——${toYou(a.content)}` : ""}。我没有什么大道理，只是想让你知道，有人在这儿惦记着你。`,
      bright ? `我翻了翻档案柜，找到了${md(bright.occurredAt)}的那一页：${toYou(bright.content)}。那时候心里亮着的光，现在也还在，只是被最近的事挡住了一会儿。` : "",
      `今晚早点睡，明天出门晒晒太阳。如果愿意，给我回一封信，说说现在的你，哪怕只有一句。`,
      sign,
    ].filter(Boolean).join("\n\n");
    return { subject: "给正在熬着的你", body, cited: [a, bright].filter(Boolean).map((m) => m!.id) };
  }
  if (c.type === "open_loop") {
    const body = [
      `${c.name}，见字如面：`,
      `${c.reason}。${a ? `我记得你当时说：${toYou(a.content)}。` : ""}`,
      `所以我忍不住想来问问：后来怎么样了？不管结果如何，那段时间认真准备的你，都值得被好好夸一句。`,
      `有空的话，回信告诉我吧。`,
      sign,
    ].join("\n\n");
    return { subject: "那件事，后来怎么样了？", body, cited };
  }
  if (c.type === "greeting") {
    const body = [
      `${c.name}，你好呀：`,
      `${c.reason}。${a ? `${md(a.occurredAt)}，${toYou(a.content)}。` : ""}`,
      flavor(`没什么特别的事，就是想问问：你最近好吗？吃得好不好，睡得好不好？${gentleCatchphrase(c.style) ? `你总说「${gentleCatchphrase(c.style)}」，我也这么觉得。` : ""}`, c.style),
      `想说什么的时候，随时写信给我。`,
      sign,
    ].join("\n\n");
    return { subject: "想问问你最近好吗", body, cited };
  }
  const days = a ? Math.round((c.today.getTime() - a.occurredAt.getTime()) / 86_400_000) : 0;
  const body = [
    `${c.name}，见字如面：`,
    `${c.reason}。我翻了翻邮局的档案柜，${a ? `找到了${md(a.occurredAt)}的那一页：${toYou(a.content)}。` : "找到了你那时留下的一页。"}`,
    b ? `${md(b.occurredAt)}，你还记下过：${toYou(b.content)}。` : "",
    `${days > 0 ? `${days} 天过去了，` : ""}你现在再看那一天，会有不一样的感受吗？如果愿意，给我回一封信，说说现在的你。`,
    sign,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject: a ? `还记得${md(a.occurredAt)}吗` : "一封回顾信", body, cited };
}

/** 以收件人（某个真实的人）的身份代笔回信：只用他知道的事 */
export function mockPersonaReply(c: {
  name: string;
  userName: string;
  moment: string;
  momentAt: Date | null;
  letter: string;
  known: MemLite[];
  isFirst: boolean;
}): { subject: string; body: string; cited: string[] } {
  const echo = letterEcho(c.letter);
  const k = c.known[0];
  const when = c.momentAt ? `${c.momentAt.getFullYear()}年${md(c.momentAt)}` : "那天";
  // 记忆里写的是「和小鹿……」，以小鹿的口吻说出来要换成「我」
  const asMe = (s: string) => toYou(s).replaceAll(c.name, "我");
  const body = [
    `${c.userName}：`,
    c.isFirst
      ? `收到你的信真的很意外，也很开心。${c.moment ? `你说的${when}那件事——${clip(swapPerson(c.moment), 40)}——说实话我都快忘了，没想到你一直记着。` : "没想到你还记得我。"}`
      : `又收到你的信了，开心。`,
    echo ? `你信里说「${echo}」，我读了好几遍。` : "",
    k ? `我也还记得${md(k.occurredAt)}，${asMe(k.content)}。` : "",
    `你最近过得怎么样？信里没细说的那些，我都很想听。有空再写信给我吧。`,
    `—— ${c.name}`,
  ].filter(Boolean).join("\n\n");
  return { subject: c.isFirst ? `${c.name}的回信` : "收到你的信了", body, cited: k ? [k.id] : [] };
}

/** 以平行时空的自己代笔回信：分岔点之前与你相同 */
export function mockParallelReply(c: {
  userName: string;
  divergence: string;
  divergenceAt: Date;
  letter: string;
  memories: MemLite[];
  style: StyleFingerprint | null;
}): { subject: string; body: string; cited: string[] } {
  const a = c.memories[0];
  const when = `${c.divergenceAt.getFullYear()}年${md(c.divergenceAt)}`;
  const premise = clip(c.divergence.replace(/^(如果|要是|假如)(当时)?/, ""), 30);
  const echo = letterEcho(c.letter);
  const body = [
    `真实时空的${c.userName}：`,
    `${echo ? `你问「${echo}」——` : ""}我在这边过得还行。${when}那天，我${premise ? `选了另一条路：${premise}` : "做了和你不一样的选择"}。`,
    a ? `分岔之前的事我都记得，${toFirst(a.content)}。那时候的我们还是同一个人。` : "",
    flavor(`后来的日子有得有失。我也会在某些晚上想，如果当时像你一样选，现在会是什么样子。所以我挺好奇你那边的生活。${gentleCatchphrase(c.style) ? `${gentleCatchphrase(c.style)}。` : ""}`, c.style),
    `下次写信，告诉我你那边今天发生了什么吧。`,
    `—— 平行时空里，${when}选了另一条路的你`,
  ].filter(Boolean).join("\n\n");
  return { subject: "来自另一条路的回信", body, cited: a ? [a.id] : [] };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
/** 「那个瞬间」是你写的（我 = 你，他/她 = 收件人），由收件人复述时人称对调 */
const swapPerson = (s: string) => s.replace(/[我他她]/g, (ch) => (ch === "我" ? "你" : "我"));

export function mockStory(c: { text: string; place?: string | null; caption?: string | null; conversation: string; title?: string | null }) {
  const lines = [c.text, c.conversation].join("。").split(/[。！？\n]/).map((s) => s.trim()).filter((s) => s.length > 3);
  const core = lines.slice(0, 3).join("，").replace(/今天|今晚/g, "那天").replace(/^那天[，,]?/, "");
  const narrative = `${c.place ? `那天在${c.place}，` : "那天，"}${core.replace(/我/g, "你")}。${c.caption ? `画面里${c.caption.slice(0, 30)}。` : ""}后来回想起来，那不是什么了不起的大事，却是你很想留住的一个下午——风是对的，人也是对的。`;
  const quoteSrc = lines.find((l) => l.length >= 6 && l.length <= 20) ?? "有些日子，值得被认真记住";
  return { title: c.title || (c.place ? `${c.place}的一天` : "平凡又闪光的一天"), narrative: narrative.slice(0, 220), quote: quoteSrc.replace(/我/g, "你") };
}

export function mockRecap(c: { month: string; memories: MemLite[]; topPeople: string[]; topPlaces: string[]; avgMood: number; count: number }) {
  const [y, m] = c.month.split("-");
  const tone = c.avgMood > 0.25 ? "明亮" : c.avgMood < -0.15 ? "有些沉" : "平稳";
  const hl = c.memories.slice(0, 3);
  return {
    title: c.avgMood > 0.25 ? `${Number(m)}月，有光` : c.avgMood < -0.15 ? `${Number(m)}月，慢慢走` : `${Number(m)}月的日常`,
    narrative: `${y}年${Number(m)}月，你一共放进来 ${c.count} 颗胶囊。这个月的底色是${tone}的。${c.topPeople.length ? `${c.topPeople.slice(0, 2).join("和")}出现得最多，他们是这个月的配角，也是靠山。` : ""}${c.topPlaces.length ? `你的足迹落在${c.topPlaces.slice(0, 3).join("、")}。` : ""}${hl[0] ? `最亮的一刻是${md(hl[0].occurredAt)}——${hl[0].content}。` : ""}${hl[1] ? `你也记下了${hl[1].content}。` : ""}这些片段拼在一起，就是你认真生活过的证据。`,
    keywords: [...c.topPlaces.slice(0, 2), ...c.topPeople.slice(0, 2), tone].filter(Boolean).slice(0, 5),
    highlights: hl.map((x) => ({ memoryId: x.id, line: `${md(x.occurredAt)}，值得被反复想起` })),
    nextMonthNote: c.avgMood < 0 ? "下个月，记得对自己好一点，多去见想见的人。" : "下个月，继续把好日子记下来。",
  };
}

export function mockProfile(c: { name: string; people: string[]; places: string[]; goals: string[]; prefs: string[] }) {
  const traits = [
    c.places.length >= 2 ? "爱四处走走" : null,
    c.people.length ? `重视${c.people[0]}` : null,
    c.goals.length ? "心里有目标" : null,
    c.prefs.length ? "有自己的小喜好" : null,
    "认真生活",
  ].filter(Boolean) as string[];
  const summary = `你是一个认真对待日子的人。${c.people.length ? `${c.people.slice(0, 3).join("、")}常常出现在你的记录里。` : ""}${c.places.length ? `你去过${c.places.slice(0, 3).join("、")}，` : ""}${c.goals[0] ? `心里一直惦记着「${c.goals[0].slice(0, 24)}」。` : ""}${c.prefs[0] ? `你说过${c.prefs[0].slice(0, 24)}。` : ""}我还在慢慢认识你。`;
  return { summary, traits: traits.slice(0, 6) };
}

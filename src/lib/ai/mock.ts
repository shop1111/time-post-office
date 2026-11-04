/**
 * Mock 演示模式：没有配置 API Key 时使用。
 * 不是写死的台词——会利用检索到的真实记忆、文风指纹和记录内容拼出有上下文的回复。
 */
import type { StyleFingerprint } from "@/lib/types";
import { flavor, gentleCatchphrase } from "@/lib/memory/style";
import type { TurnPlan, LetterPlan } from "@/lib/curator/planner";
import { termPhrase, type WorldState } from "@/lib/curator/world";
import type { Stage } from "@/lib/curator/relationship";

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
  lastUser?: string;
  related: MemLite[];
  plan: TurnPlan;
  world: WorldState;
  stage: Stage;
}): string {
  const seed = seedOf(c.text + (c.lastUser ?? "") + c.plan.act);
  const echo = c.lastUser ? summarizeEcho(c.lastUser) : "";
  const detail = summarizeEcho(c.text);
  const rel = c.related[0];
  const night = c.world.timeOfDay === "夜里" || c.world.timeOfDay === "深夜";
  switch (c.plan.act) {
    case "notice": {
      const opener =
        c.type === "photo"
          ? pick([`照片收到了${c.place ? `，${c.place}` : ""}。`, "这张我拿在手里看了一会儿。"], seed)
          : c.type === "voice"
            ? pick(["你的声音我听了两遍。", "语音收到了。"], seed)
            : detail ? `「${detail}」——这句我多看了两眼。` : "收到了。";
      const recall = rel ? `${md(rel.occurredAt)}你好像也说过「${rel.content.slice(0, 18)}」。` : "";
      const q = c.type === "photo"
        ? pick(["那天谁在镜头外面？", "按快门的时候在想什么？", "这是谁拍的？"], seed)
        : pick(["那会儿身边有谁？", "这是在哪儿？", "后来呢？"], seed);
      return `${opener}${recall}${q}`;
    }
    case "ask":
      return `${echo ? `「${echo}」，` : ""}${pick(["当时谁在旁边？", "那是在哪儿？", "那一下你在想什么？", "后来呢？", "是第一次吗？"], seed)}`;
    case "follow":
      return `${echo ? `${echo}啊。` : "嗯。"}${pick([`我这边${c.world.scene}。`, "我记下了。", "这个我想象得出来。"], seed)}${pick(["想说再说。", "", "不急。"], seed >> 2)}`;
    case "answer":
      return `我啊，${c.world.timeOfDay}${pick([c.world.scene, `在给档案柜换标签，瓶子里插着${c.world.vase}`], seed)}。${pick(["你呢？", "没什么特别的。", ""], seed >> 1)}`;
    case "comfort":
      return pick(["嗯，我在。", "先不急着说。我陪你待一会儿。", "这几天辛苦了。", "……我听着呢。"], seed);
    case "reopen": {
      const hook = detail ? `刚才「${detail}」那里还没细说。` : "";
      return `${pick(["好呀。", "行，那再坐会儿。", "我正好也不忙。"], seed)}${hook}${pick(["那天最想留住的是哪一下？", "要是再来一次，你会想改哪一点？", "这件事你还跟谁说过？"], seed >> 1)}`;
    }
    case "close": {
      const keep = echo || detail;
      if (c.plan.last) {
        const bye = night ? "早点睡。" : pick(["回头见。", "下次再来坐。"], seed >> 2);
        return `今天聊得差不多啦。${keep ? `「${keep}」我记下了，` : ""}${pick(["邮票都在柜台上睡着了。", "茶都续了两回了。"], seed)}${bye}`;
      }
      const where = pick([`档案柜${c.world.term.current}那一格`, "柜台左手边第二个抽屉", "靠窗那排档案柜"], seed);
      const cat = pick(["邮票在上面踩了一脚，算是盖了章。", "邮票闻了闻，没意见。", ""], seed >> 1);
      const bye = night ? pick(["早点睡。", "晚安。"], seed >> 2) : pick(["回头见。", "下次再来。", "去忙吧。"], seed >> 2);
      return `${keep ? `「${keep}」我记住了。` : ""}放在${where}了。${cat}${bye}`;
    }
    case "repair":
      return mockRepair(c.world, seed, detail);
  }
}

/** 用户在说小局的说话方式：不道歉，直接多说点具体的 */
function mockRepair(world: WorldState, seed: number, topic: string): string {
  return `${topic ? `那接着说「${topic}」。` : ""}我这边${world.timeOfDay}，${world.scene}，瓶子里插着${world.vase}，${termPhrase(world.term)}。${pick(["你刚才说的那件事，我其实还想多听一点：当时身边有谁？", "说真的，我挺想知道你今天最想跟人说的是哪件事。"], seed)}`;
}

/** 「和小局聊聊」的演示回复 */
export function mockChat(c: { lastUser: string; act: string; related: MemLite[]; world: WorldState }): string {
  const seed = seedOf(c.lastUser + c.act);
  const echo = summarizeEcho(c.lastUser);
  const rel = c.related[0];
  switch (c.act) {
    case "repair":
      return mockRepair(c.world, seed, "");
    case "recall":
      return rel
        ? `记得。${md(rel.occurredAt)}你跟我说过「${rel.content.slice(0, 24)}」，我一直记着。你放进来的每颗胶囊我都翻过，还想多知道一点你最近在忙什么。`
        : "记得你，只是你放进来的胶囊还不多，我知道的还太少。多跟我说说你自己吧，喜欢什么、最近在忙什么。";
    case "answer":
      return `我啊，${c.world.timeOfDay}${pick([c.world.scene, `在给档案柜换标签，瓶子里插着${c.world.vase}`], seed)}。${pick(["你呢？", "没什么特别的。", ""], seed >> 1)}`;
    case "comfort":
      return pick(["嗯，我在。", "先不急着说。我陪你待一会儿。", "辛苦了。想说就说，不想说也行。", "……我听着呢。"], seed);
    case "follow":
      return `${echo ? `${echo}啊。` : "嗯。"}${pick([`我这边${c.world.scene}。`, "我在呢。", "不急，慢慢说。"], seed)}`;
    default: {
      const recall = rel ? pick([`说起来，${md(rel.occurredAt)}你跟我讲过「${rel.content.slice(0, 16)}」。`, ""], seed >> 1) : "";
      return `${echo ? `「${echo}」——` : ""}${pick(["这个我想听。", "嗯，我记着呢。", "有意思。"], seed)}${recall}${pick(["后来呢？", "", "你当时怎么想的？"], seed >> 2)}`;
    }
  }
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

/** 小局来信：按信的形态（LetterPlan）调整模板——要不要附言、结尾问不问 */
export function mockCuratorLetter(c: Parameters<typeof baseCuratorLetter>[0] & { plan?: LetterPlan; world?: WorldState }) {
  const out = baseCuratorLetter(c);
  let paras = out.body.split("\n\n");
  if (c.plan && !c.plan.endWithQuestion && paras.length > 3) {
    const i = paras.length - 2;
    if (/[？?]|回信|写信给我/.test(paras[i])) paras = [...paras.slice(0, i), ...paras.slice(i + 1)];
  }
  if (c.plan?.shape === "带附言的信" && c.world) paras.splice(paras.length - 1, 0, `P.S. ${c.world.scene}。`);
  return { ...out, body: paras.join("\n\n") };
}

function baseCuratorLetter(c: {
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
      `你写的这些，我都收在柜台抽屉里了。`,
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

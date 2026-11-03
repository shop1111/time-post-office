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

export function mockLetter(c: {
  sender: "past_self" | "future_self" | "postman";
  reason: string;
  memories: MemLite[];
  style: StyleFingerprint | null;
  name: string;
  writtenAt: Date;
  today: Date;
}): { subject: string; body: string; cited: string[] } {
  const ms = c.memories.slice(0, 4);
  const [a, b] = ms;
  const days = Math.round((c.today.getTime() - c.writtenAt.getTime()) / 86_400_000);
  const cited = ms.slice(0, 3).map((m) => m.id);
  const catchy = gentleCatchphrase(c.style);
  if (c.sender === "past_self") {
    const isPlan = c.reason.includes("已经到了");
    const body = [
      `${days} 天后的我：`,
      `写这封信的时候是${md(c.writtenAt)}。${a ? `${toFirst(a.content)}。` : ""}我想把此刻的心情存起来，寄给读到这封信的你。`,
      isPlan
        ? `那个日子应该已经过去了吧？结果怎么样？不管过没过，我都想先跟你说一声：辛苦了。那时候的我每天都在给你打气呢。`
        : b
          ? `还有一件事我不想忘：${toFirst(b.content)}。不知道你现在还记不记得那时候的感觉？`
          : "不知道你现在还记不记得那时候的感觉？",
      flavor(`我说不准以后会怎样，但我希望你还保留着现在这份认真。${catchy ? `${catchy}。` : ""}有空的话，回信告诉我你现在的样子。`, c.style),
      `—— ${md(c.writtenAt)} 的你`,
    ].join("\n\n");
    return { subject: isPlan ? "那件事，后来怎么样了？" : `来自${md(c.writtenAt)}的你`, body, cited };
  }
  if (c.sender === "future_self") {
    const bright = ms.slice(1).find((m) => m.occurredAt.getTime() < (a?.occurredAt.getTime() ?? 0) - 7 * 86_400_000) ?? b;
    const body = [
      `亲爱的${c.name}：`,
      `我是几年后的你。我知道你最近不太好受${a ? `——${toYou(a.content)}` : ""}。我想告诉你，那些让你觉得过不去的晚上，后来都变成了你身上很柔软的一部分。`,
      bright ? `你还记得${md(bright.occurredAt)}吗？${toYou(bright.content)}。那时候心里亮着的光，现在也还在，只是被最近的事挡住了一会儿。` : "",
      flavor(`那时候的你也许没发现，你其实一直在往前走，只是走得很慢。${catchy ? `你自己总说「${catchy}」，现在我把这句话还给你。` : "慢一点也没关系。"}`, c.style),
      `今晚早点睡，明天出门晒晒太阳。剩下的，交给时间，也交给我。`,
      `—— 一直站在前面等你的，未来的你`,
    ].filter(Boolean).join("\n\n");
    return { subject: "给正在熬着的你", body, cited: [a, bright].filter(Boolean).map((m) => m!.id) };
  }
  const body = [
    `${c.name}，见字如面：`,
    `${c.reason}。我翻了翻邮局的档案柜，${a ? `找到了${md(a.occurredAt)}的那一页：${toYou(a.content)}。` : "找到了你那时留下的一页。"}`,
    b ? `${md(b.occurredAt)}，你还记下过：${toYou(b.content)}。` : "",
    `${days > 0 ? `${days} 天过去了，` : ""}你现在再看那一天，会有不一样的感受吗？如果愿意，给我回一封信，说说现在的你。`,
    `—— 替你保管时光的邮差`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject: a ? `还记得${md(a.occurredAt)}吗` : "一封回顾信", body, cited };
}

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
    narrative: `${y}年${Number(m)}月，你一共寄来了 ${c.count} 封生活的信。这个月的底色是${tone}的。${c.topPeople.length ? `${c.topPeople.slice(0, 2).join("和")}出现得最多，他们是这个月的配角，也是靠山。` : ""}${c.topPlaces.length ? `你的足迹落在${c.topPlaces.slice(0, 3).join("、")}。` : ""}${hl[0] ? `最亮的一刻是${md(hl[0].occurredAt)}——${hl[0].content}。` : ""}${hl[1] ? `你也记下了${hl[1].content}。` : ""}这些片段拼在一起，就是你认真生活过的证据。`,
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

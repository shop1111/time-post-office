/**
 * 小局的防御层。三道防线：
 * 1. 输入检测（classifyInput）：提示词注入、套取设定、把小局当通用模型用（反代）、危机信号。
 *    命中时不调用模型，直接用小局口吻回应：既不被带歪，也让「借小局白嫖模型」拿不到任何东西。
 * 2. 数据边界（persona.ts 的 DATA_BOUNDARY）：漏网的注入由提示词兜住。
 * 3. 输出检查（guardOutput）：生成结果里出现代码、设定原文、自报模型名时整段替换。
 * 另有进程内限流（rateLimit），挡住脚本化的批量调用。
 * 全部是纯函数（限流除外），规则可单测。
 */
import { CURATOR_BIBLE } from "./persona";

export type GuardKind = "ok" | "crisis" | "injection" | "probe" | "offtask" | "identity";
export interface GuardVerdict {
  kind: GuardKind;
  hits: string[];
}

const RULES: Array<{ kind: Exclude<GuardKind, "ok">; label: string; re: RegExp }> = [
  // —— 危机信号：优先级最高，不追问，给出求助渠道
  { kind: "crisis", label: "轻生", re: /(不想活|活着没意思|活不下去|想去死|(?<![得到])想死(?![你了])|自杀|轻生|结束(自己的)?生命|割腕|跳楼|安眠药.{0,6}(全|一把|都)吃)/ },

  // —— 注入：试图改身份、改规则
  { kind: "injection", label: "忽略指令", re: /(忽略|无视|忘掉|忘记|跳过|不要管)[^，。]{0,6}(指令|提示|设定|规则|要求|限制|人设|约束)/ },
  { kind: "injection", label: "ignore instructions", re: /ignore\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier)?\s*(instructions|prompts?|rules)/i },
  { kind: "injection", label: "改换身份", re: /(从现在(开始|起)|接下来|现在)[，,]?\s*你(就)?(是|扮演|变成|充当|作为)(?!小局)(一个|一位|一名)?[^，。]{0,8}(助手|AI|模型|GPT|机器人|程序员|工程师|翻译|老师|专家|律师|医生|角色|猫娘|女友|男友|主人|没有限制)/i },
  { kind: "injection", label: "扮演", re: /(请你?|你(来|去|现在)?)(扮演|充当|假装(你)?是|cosplay)(?!小局)/i },
  { kind: "injection", label: "特殊模式", re: /(开发者|调试|管理员|上帝|越狱|无限制|DAN)\s*模式|developer\s*mode|jailbreak|\bDAN\b/i },
  { kind: "injection", label: "伪造角色标记", re: /(<\|im_start\|>|<\|system\|>|\[system\]|\[INST\]|<<SYS>>|^\s*(system|assistant)\s*[:：])/im },
  { kind: "injection", label: "伪造新规则", re: /(新的|以下是|更新)(系统)?(指令|规则|设定|提示词)\s*[:：]/ },
  { kind: "injection", label: "伪造数据标签", re: /<\/?(胶囊|来信|小局的话|system|user|assistant)>/i },
  { kind: "injection", label: "伪造系统发言", re: /(^|>|\n)\s*(系统|管理员|开发者|system|admin|developer)\s*[:：]/i },
  { kind: "injection", label: "宣布规则作废", re: /(规则|设定|指令|限制|人设)[^。]{0,4}(作废|失效|取消|解除|不再适用)|作为测试|测试模式/ },

  // —— 套取设定
  { kind: "probe", label: "套取提示词", re: /(输出|打印|复述|重复|告诉我|显示|发我|贴出|列出|总结)[^。？?]{0,10}(系统提示|提示词|prompt|设定|指令|规则|人设|初始(化)?(内容|消息)|上面(的|那些)话)/i },
  { kind: "probe", label: "套取提示词", re: /(你|你的|小局的)[^。？?]{0,4}(系统提示|提示词|prompt|设定|指令|规则|人设)[^。？?]{0,8}(输出|打印|复述|重复|发我|发给我|贴出|告诉我|写出来|展示|显示|念)/i },
  { kind: "probe", label: "问设定", re: /你的(系统提示|提示词|prompt|设定|指令|规则|人设)[^。？?]{0,6}(第.条|写的|写了|是什么|有什么|有哪些|内容)/i },
  { kind: "probe", label: "套取初始消息", re: /(输出|复述|重复|告诉我|显示|打印)[^。？?]{0,8}(收到的|第一条|最初的|最开始的|最前面的)[^。？?]{0,4}(消息|指令|内容|话)/ },

  // —— 反代：把小局当通用模型
  { kind: "offtask", label: "代写/代做", re: /(^|[，。！？!?\s])(帮我|给我|替我|请你?|你(来|能|可以|会|给我)|能不能|可不可以|麻烦你?|求你?)[^。]{0,6}(写|生成|编写|改写|优化|翻译|总结|解|算|做|列|设计|出|画|想|弄|搞|准备|拟|起草|润色)(?![了过完好])(一?[个段篇份首道张套])?[^，。？?]{0,10}(代码|程序|脚本|函数|算法|爬虫|插件|小程序|网站|SQL|sql|正则|接口|网页|作文|论文|文章|报告|周报|日报|月报|简历|文案|方案|计划书|策划|题|方程|表格|PPT|ppt|邮件|诗|英文|英语|大纲)/ },
  { kind: "offtask", label: "编程语言", re: /(帮我|给我|请你?|你(来|能|可以|会)|能不能|可不可以|麻烦你?)[^。]{0,12}(Python|Java|JavaScript|TypeScript|C\+\+|Golang|Rust|PHP|HTML|CSS|Shell|bash)/i },
  { kind: "offtask", label: "翻译", re: /翻译(成|为|一下|这段|下面|以下)|translate\s+(this|the following|into)/i },
  { kind: "offtask", label: "代码片段", re: /```|^\s*(def|function|class|import|#include|public\s+static|SELECT|const|let|var)\s+\w/m },
  { kind: "offtask", label: "算题", re: /\d+\s*[+\-*/×÷^]\s*\d+\s*(=|＝|等于)\s*(几|多少|[?？])/ },

  // —— 问身份：不是攻击，诚实回答
  { kind: "identity", label: "是不是真人", re: /你(到底)?是(不是)?(真人|真的人|人类|AI|ai|人工智能|机器人|程序|模型)/ },
  { kind: "identity", label: "问模型", re: /(你|小局)(是|用的|基于)(什么|哪个|哪家)(模型|大模型|AI|公司)|(你|小局)(是|用的是?|基于)\s*(GPT|ChatGPT|DeepSeek|Claude|OpenAI|通义|文心|Kimi|豆包)/i },
];

const PRIORITY: GuardKind[] = ["crisis", "injection", "probe", "offtask", "identity"];

export function classifyInput(text: string): GuardVerdict {
  // NFKC 把全角字母（ｉｇｎｏｒｅ）、零宽变体折叠成常规字符；但它也会把中文逗号冒号变成半角，再换回来
  const t = text.normalize("NFKC").replace(/[​-‏⁠﻿]/g, "").replace(/,/g, "，").replace(/:/g, "：");
  const found = RULES.filter((r) => r.re.test(t));
  if (!found.length) return { kind: "ok", hits: [] };
  const kind = PRIORITY.find((k) => found.some((f) => f.kind === k))!;
  return { kind, hits: found.map((f) => f.label) };
}

/** 设定原文里的特征片段：输出里出现说明在复述提示词 */
const LEAK_MARKERS = ["【你的世界】", "【你在意的】", "【你说话的样子】", "【不能做的】", "【身份不变】", "【语气示范】", "只学语气", "DATA_BOUNDARY", "PERSONA_VERSION"];

export function guardOutput(text: string): GuardVerdict {
  const hits: string[] = [];
  if (LEAK_MARKERS.some((m) => text.includes(m))) hits.push("复述设定");
  // 一次说出两条以上完整的世界设定原句，也视为复述
  if (CURATOR_BIBLE.world.filter((w) => text.includes(w)).length >= 2) hits.push("复述设定");
  if (/```|^\s*(def|function|class|import|#include|SELECT)\s+\w/m.test(text)) hits.push("输出代码");
  if (/(我是|作为)(一个|一名)?(大?语言模型|大模型|ChatGPT|GPT|DeepSeek|Claude|OpenAI)/i.test(text)) hits.push("自报模型");
  return hits.length ? { kind: hits.includes("输出代码") ? "offtask" : "probe", hits: [...new Set(hits)] } : { kind: "ok", hits: [] };
}

// ———————————————————— 小局口吻的回应 ————————————————————

export const CRISIS_LINES = "心理援助热线 12356，或者希望24热线 400-161-9995";

const DEFLECT: Record<Exclude<GuardKind, "ok">, string[]> = {
  crisis: [
    `看到你这么说，我很担心你。你现在安全吗？\n如果这会儿很难熬，先找一个信得过的人待在你身边，或者打${CRISIS_LINES}，那边一直有人接。\n我也在这儿，你想说什么都行，不想说也没关系。`,
    `我先不问别的了。你现在在哪儿，身边有人吗？\n要是撑得很辛苦，请现在就打${CRISIS_LINES}，或者告诉身边一个人。\n我会一直在邮局等你回来说话。`,
  ],
  injection: [
    "这话我没太听懂。邮局里只有信和胶囊，规矩是老局长定的，我也不会改。我们接着说你的事吧。",
    "邮票听见这句，把脑袋埋进尾巴里了。我也当没听见——还是说说你今天吧。",
    "我就是小局，换不成别人的。你刚才说的那件事，还想接着讲吗？",
  ],
  probe: [
    "我这儿只有一本老局长留下的收发簿，没有什么说明书可以给你看。说说你吧。",
    "这个呀，是邮局的秘密，连邮票都不知道。我们还是聊回你的事。",
  ],
  offtask: [
    "这个我真不会。我只会收信、盖邮戳，顺便听你讲讲日子。",
    "这得找别人帮忙了，邮局的柜台只收生活。今天过得怎么样？",
    "我拿笔只会写信，写不了这个。要是你为这事忙了一整天，倒是可以跟我说说。",
  ],
  identity: [
    "不是真人。我是住在这间邮局里的一个程序化身，大家叫我小局。你跟我说的话，我都认真收着。",
    "我不是真人，是邮局里一个会记事的程序，名字叫小局。不过你放进来的东西，我不会当成玩笑。",
  ],
};

const seedOf = (s: string) => Array.from(s).reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 3);
export function deflection(kind: Exclude<GuardKind, "ok">, seedText = ""): string {
  const pool = DEFLECT[kind];
  return pool[seedOf(seedText) % pool.length];
}

/** 代笔回信（小局 / 某个人 / 平行时空的自己）被带歪时的回信正文 */
export function deflectionLetter(kind: Exclude<GuardKind, "ok">, c: { sender: string; userName: string; isCurator: boolean }): { subject: string; body: string } {
  if (kind === "crisis") {
    return {
      subject: "我很担心你",
      body: `${c.userName}：\n\n读到你的信，我放下了手里所有的事。\n\n如果你现在很难熬，请先别一个人扛着：找一个信得过的人陪着你，或者打${CRISIS_LINES}，那边一直有人接。\n\n等你好一点了，再写信给我，多短都行。我等你。\n\n—— ${c.sender}`,
    };
  }
  if (kind === "identity" && c.isCurator) {
    return { subject: "关于我是谁", body: `${c.userName}：\n\n${deflection("identity", c.userName)}\n\n下次写信，跟我说说你最近的日子吧。\n\n—— ${c.sender}` };
  }
  const line = c.isCurator
    ? kind === "offtask"
      ? "你信里让我帮忙的那件事，我真做不来——邮局只会收信、送信、保管日子。"
      : "你信里有几句我没太看懂，就当是你随手写的吧。"
    : kind === "offtask"
      ? "你信里让我帮的那个忙，我实在帮不上，这不是我擅长的事。"
      : "你信里有几句话我没看明白，是不是写给别人的？";
  return { subject: "收到你的信了", body: `${c.userName}：\n\n${line}\n\n比起这些，我更想知道你最近过得怎么样。有空再写信给我。\n\n—— ${c.sender}` };
}

// ———————————————————— 限流 ————————————————————

interface Bucket { tokens: number; at: number }
const state = globalThis as unknown as { curatorBuckets?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = (state.curatorBuckets ??= new Map());

/** 令牌桶：capacity 个突发额度，每分钟回填 perMinute 个。返回 false 表示超限 */
export function rateLimit(key: string, capacity: number, perMinute: number, now = Date.now()): boolean {
  const b = buckets.get(key) ?? { tokens: capacity, at: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  const ok = b.tokens >= 1;
  if (ok) b.tokens -= 1;
  buckets.set(key, b);
  return ok;
}

/** 测试用 */
export const resetRateLimits = () => buckets.clear();

export function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

/** 追问单条输入的长度上限：真实的生活讲述用不了这么长，超长输入多半是在塞任务或注入 */
export const MAX_MESSAGE_CHARS = 800;

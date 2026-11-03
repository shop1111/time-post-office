import type { PostmanOutcome, PostmanStage } from "@/lib/types";

export const TRIGGER_LABEL: Record<string, string> = {
  anniversary: "周年回顾",
  open_loop: "未完结的线索",
  low_mood: "情绪关怀",
  milestone: "里程碑",
  capsule: "时间胶囊",
  welcome: "初次见面",
  manual: "邮差手写",
};

/** 每种去向的说法；判断顺序和后端一致：已寄过 → 频控 → 同类 → 名额 → 写信 */
export const OUTCOME: Record<PostmanOutcome, { label: string; hint: string; tone: "done" | "busy" | "fail" | "muted" }> = {
  selected: { label: "正在写", hint: "邮差选中了它，正在写信", tone: "busy" },
  generated: { label: "已送达", hint: "写好并投进了信箱", tone: "done" },
  failed: { label: "没写成", hint: "这封出错了，其他信照常送达", tone: "fail" },
  deduplicated: { label: "已寄过", hint: "这件事之前已经写过信", tone: "muted" },
  rate_limited: { label: "太频繁", hint: "距离上一封来信不到 20 小时", tone: "muted" },
  type_limited: { label: "同类已写", hint: "这一轮已经写了同一类的信", tone: "muted" },
  quota_limited: { label: "名额用完", hint: "这一轮能写的信已经写满了", tone: "muted" },
};

export const STAGE_LABEL: Record<PostmanStage, string> = {
  retrieve: "翻找回忆",
  generate: "写信",
  check: "事实核查",
  deliver: "投进信箱",
};

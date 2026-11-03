export type EntryType = "photo" | "voice" | "text";
export type MemoryKind = "event" | "fact" | "person" | "place" | "goal" | "plan" | "preference";
export type EntityType = "person" | "place" | "theme";
export type Sender = "past_self" | "future_self" | "postman" | "user";
export type TriggerType = "anniversary" | "open_loop" | "low_mood" | "milestone" | "capsule" | "welcome" | "manual";

export const SENDER_LABEL: Record<Sender, string> = {
  past_self: "过去的你",
  future_self: "未来的你",
  postman: "时光邮差",
  user: "你自己",
};

export const KIND_LABEL: Record<MemoryKind, string> = {
  event: "经历",
  fact: "事实",
  person: "人物",
  place: "地点",
  goal: "心愿",
  plan: "计划",
  preference: "喜好",
};

export interface StyleFingerprint {
  avgSentenceLen: number;
  exclaimRate: number;
  questionRate: number;
  ellipsisRate: number;
  emojiRate: number;
  particles: string[]; // 句尾语气词：吧 / 呀 / 啦 ...
  catchphrases: string[]; // 高频口头禅
  topWords: string[];
  samples: string[]; // 代表性原句
}

export interface ExtractedMemory {
  kind: MemoryKind;
  content: string;
  importance: number;
  dueDate?: string | null;
  entities: Array<{ name: string; type: EntityType }>;
}

export interface Extraction {
  title: string;
  summary: string;
  mood: number;
  emotions: string[];
  place?: string | null;
  memories: ExtractedMemory[];
}

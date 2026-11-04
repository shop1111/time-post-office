import type { RankWeights } from "@/lib/memory/rank";

export type EntryType = "photo" | "voice" | "text";
export type MemoryKind = "event" | "fact" | "person" | "place" | "goal" | "plan" | "preference";
export type EntityType = "person" | "place" | "theme";
/** 寄信人：user = 你写的信；curator = 邮局局长小局；persona = agent 以收件人身份代笔。past_self / future_self / postman 只出现在旧数据里 */
export type Sender = "user" | "curator" | "persona" | "past_self" | "future_self" | "postman";
export type TriggerType =
  | "anniversary" | "open_loop" | "low_mood" | "milestone" | "greeting"
  | "reply" | "future_letter" | "letter" | "welcome" | "manual" | "capsule";
/** 收件人：某个人 / 平行时空的自己 / 未来的自己 / 小局 */
export type CorrespondentKind = "person" | "parallel_self" | "future_self" | "curator";
/** 只有虚拟形象才由 agent 代笔回信；写给未来自己的信由真实的你在未来收到 */
export const VIRTUAL_KINDS: CorrespondentKind[] = ["person", "parallel_self", "curator"];
export const CURATOR_NAME = "小局";

export const SENDER_LABEL: Record<Sender, string> = {
  user: "你",
  curator: "小局",
  persona: "代笔回信",
  past_self: "旧版来信",
  future_self: "旧版来信",
  postman: "小局",
};

export const CORRESPONDENT_KIND_LABEL: Record<CorrespondentKind, string> = {
  person: "某个人",
  parallel_self: "平行时空的自己",
  future_self: "未来的自己",
  curator: "邮局局长",
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

/** M1/M2/M3 的公共传输类型。日期均为 ISO 8601 字符串，不依赖 Prisma。 */
export interface ExecutionInfo {
  mode: "remote" | "mock" | "fallback";
  model?: string;
  durationMs: number;
  fallbackReason?: string;
}
export interface ApiError { error: string; code: string; retryable: boolean }
export interface StreamError { code: string; message: string; retryable: boolean }
export type HeartbeatEvent = Record<string, never>;
export interface InterviewDoneEvent { final: boolean; execution: ExecutionInfo }
export type InterviewErrorEvent = StreamError;
export interface InterviewMetaEvent {
  round: number;
  maxRounds: number;
  final: boolean;
  weights: RankWeights;
  related: Array<{
    id: string; content: string; date: string; score: number; entryId: string | null;
    parts: { sim: number; recency: number; importance: number; entity: number };
  }>;
}
export interface InterviewEvents {
  meta: InterviewMetaEvent;
  delta: string;
  done: InterviewDoneEvent;
  error: InterviewErrorEvent;
  heartbeat: HeartbeatEvent;
}
export type FinalizeStage = "extract" | "embed" | "persist" | "profile" | "story";
export type StageStatus = "started" | "completed" | "failed" | "skipped";
export type FinalizeStatus = "queued" | "running" | "completed" | "partial" | "failed";
export interface FinalizeStageEvent {
  stage: FinalizeStage;
  status: StageStatus;
  durationMs?: number;
  execution?: ExecutionInfo;
}
export interface EntryDTO {
  id: string; type: string; text: string; transcript: string | null;
  photoPath: string | null; audioPath: string | null; audioMime: string | null;
  visionCaption: string | null; exifTime: string | null;
  lat: number | null; lng: number | null; place: string | null;
  occurredAt: string; mood: number | null; emotions: string;
  title: string | null; summary: string | null; interviewDone: boolean; createdAt: string;
}
export interface StoryCardDTO {
  id: string; entryId: string; title: string; narrative: string; quote: string;
  template: string; createdAt: string;
}
export interface FinalizeResult {
  extraction: Extraction;
  entry: EntryDTO;
  card: StoryCardDTO | null;
  memories: Array<{
    id: string; kind: string; content: string; importance: number; dueAt: string | null;
    entities: Array<{ name: string; type: string }>;
  }>;
  executions: Partial<Record<FinalizeStage, ExecutionInfo>>;
}
export interface FinalizeMetaEvent { jobId: string; entryId: string; stages: FinalizeStage[]; reused: boolean }
export interface FinalizeWarningEvent { stage: FinalizeStage; code: string; message: string }
export interface FinalizeDoneEvent { status: "completed" | "partial"; result: FinalizeResult }
export interface FinalizeErrorEvent extends StreamError { stage?: FinalizeStage }
export interface FinalizeStatusResponse {
  jobId: string;
  status: FinalizeStatus;
  currentStage: FinalizeStage | null;
  stages: FinalizeStageEvent[];
  result?: FinalizeResult;
  error?: FinalizeErrorEvent;
}
export interface FinalizeEvents {
  meta: FinalizeMetaEvent;
  stage: FinalizeStageEvent;
  warning: FinalizeWarningEvent;
  done: FinalizeDoneEvent;
  error: FinalizeErrorEvent;
  heartbeat: HeartbeatEvent;
}
export type PostmanAction = "tick" | "force";
export interface PostmanRequest { action?: PostmanAction }
export type PostmanOutcome = "deduplicated" | "rate_limited" | "type_limited" | "quota_limited" | "selected" | "generated" | "failed";
export type PostmanStage = "retrieve" | "generate" | "check" | "deliver";
export interface PostmanStageInfo {
  name: PostmanStage; status: StageStatus; durationMs?: number; execution?: ExecutionInfo;
}
export interface PostmanCandidate {
  key: string; type: TriggerType; sender: "curator"; priority: number; reason: string;
}
export interface PostmanDecision extends PostmanCandidate {
  rank: number;
  outcome: PostmanOutcome;
  letterId?: string;
  existingLetterId?: string;
  error?: StreamError;
  stages: PostmanStageInfo[];
}
export interface PostmanResult {
  now: string; delivered: string[]; generated: string[]; candidates: PostmanCandidate[];
  skippedByRateLimit: boolean; runId: string; durationMs: number;
  decisions: PostmanDecision[]; totalCandidates: number; ok?: true;
}
export interface PostmanMetaEvent { runId: string; action: PostmanAction; from: string; to: string }
export type PostmanDecisionEvent = PostmanDecision;
export interface PostmanStageEvent extends PostmanStageInfo { key: string }
export interface PostmanDoneEvent { result: PostmanResult }
export type PostmanErrorEvent = StreamError;
export interface PostmanEvents {
  meta: PostmanMetaEvent;
  decision: PostmanDecisionEvent;
  stage: PostmanStageEvent;
  done: PostmanDoneEvent;
  error: PostmanErrorEvent;
  heartbeat: HeartbeatEvent;
}
export type CheckStatus = "passed" | "rewritten" | "unchecked" | "failed";
export interface LetterCheckInfo { checkStatus: CheckStatus; checkNote: string }

/** 代笔回信时判定的知识边界：哪些记忆收件人会知道、哪些不会 */
export interface KnowledgeVerdict { id: string; content: string; why: string }
export interface LetterKnowledge {
  known: KnowledgeVerdict[];
  unknown: KnowledgeVerdict[];
  /** 平行时空：只用了分岔点之前的记忆 */
  before?: string;
}

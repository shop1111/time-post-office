import type { RankWeights } from "@/lib/memory/rank";

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
export type PostmanAction = "tick" | "forward" | "reset" | "force";
export interface PostmanRequest { action?: PostmanAction; days?: number }
export type PostmanOutcome = "deduplicated" | "rate_limited" | "type_limited" | "quota_limited" | "selected" | "generated" | "failed";
export type PostmanStage = "retrieve" | "generate" | "check" | "deliver";
export interface PostmanStageInfo {
  name: PostmanStage; status: StageStatus; durationMs?: number; execution?: ExecutionInfo;
}
export interface PostmanCandidate {
  key: string; type: TriggerType; sender: Exclude<Sender, "user">; priority: number; reason: string;
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

export type LetterSourceState = "current" | "corrected" | "withdrawn";
export interface LetterSource {
  memoryId: string;
  entryId: string | null;
  date: string;
  excerpt: string;
  state: LetterSourceState;
}
export interface LetterSentenceSources { text: string; sources: LetterSource[] }
export interface LetterSourcesResponse extends LetterCheckInfo {
  letterId: string;
  sentences: LetterSentenceSources[];
}

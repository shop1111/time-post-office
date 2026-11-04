import { AsyncLocalStorage } from "node:async_hooks";
import type { AiRecentCall, AiRole, ExecutionInfo } from "@/lib/types";

const context = new AsyncLocalStorage<{ purpose?: string; suppressed?: boolean }>();
const globals = globalThis as unknown as { aiRecentCalls?: AiRecentCall[] };
const recent = globals.aiRecentCalls ??= [];
export function withAiPurpose<T>(purpose: string, work: () => T): T { return context.run({ ...context.getStore(), purpose }, work); }
// chatJson只记录最终逻辑结果，内部chat/JSON修复不能把降级伪装成多次remote成功。
export function withoutAiRecording<T>(work: () => T): T { return context.run({ ...context.getStore(), suppressed: true }, work); }

export function safeDiagnosticText(value: string): string {
  let text = value;
  for (const [key, secret] of Object.entries(process.env)) {
    if (/(?:API_KEY|TOKEN|SECRET|PASSWORD)$/.test(key) && secret?.trim()) text = text.split(secret.trim()).join("[redacted]");
  }
  return text.replace(/https?:\/\/\S+/gi, "[url omitted]").replace(/\bBearer\s+\S+/gi, "Bearer [redacted]").replace(/\bsk-[\w-]+/g, "[redacted]").replace(/[\r\n]/g, " ").slice(0, 120);
}
export function safeExecution(info: ExecutionInfo): ExecutionInfo {
  return { mode: info.mode, durationMs: Number.isFinite(info.durationMs) ? Math.max(0, info.durationMs) : 0,
    ...(info.model ? { model: safeDiagnosticText(info.model) } : {}),
    ...(info.fallbackReason ? { fallbackReason: safeDiagnosticText(info.fallbackReason) } : {}) };
}
export function recordAiExecution(role: AiRole, info: ExecutionInfo, purpose = context.getStore()?.purpose) {
  if (context.getStore()?.suppressed) return;
  recent.push({ at: new Date().toISOString(), role, ...safeExecution(info), ...(purpose && /^[a-z][a-z0-9_-]{0,39}$/.test(purpose) ? { purpose } : {}) });
  if (recent.length > 30) recent.splice(0, recent.length - 30);
}
export function recentAiCalls(): AiRecentCall[] {
  // 输出时再次脱敏，避免运行中配置了新Key却返回旧缓冲中的同样文本。
  return recent.slice().reverse().map(({ at, role, purpose, ...info }) => ({ at, role, ...(purpose ? { purpose: safeDiagnosticText(purpose) } : {}), ...safeExecution(info) }));
}

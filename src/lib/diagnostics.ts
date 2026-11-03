import { db } from "@/lib/db";
import { getOffset, MS_DAY } from "@/lib/clock";
import { chat, embed, roleConfig } from "@/lib/ai/provider";
import { speechConfig } from "@/lib/ai/speech";
import { recentAiCalls, safeDiagnosticText, safeExecution } from "@/lib/ai/telemetry";
import { logError } from "@/lib/errors";
import type { AiCapability, AiRole, DiagnosticsPingResponse, DiagnosticsResponse, ExecutionInfo } from "@/lib/types";

function hostOf(base?: string): string | undefined {
  try { return base ? new URL(base).hostname || undefined : undefined; } catch { return undefined; }
}
export function capabilities(): AiCapability[] {
  return (["chat", "vision", "embed", "asr", "tts"] as AiRole[]).map((role) => {
    const localEmbed = role === "embed" && process.env.EMBED_MODE !== "api";
    const config = role === "tts" ? speechConfig() : localEmbed ? null : roleConfig(role);
    const host = hostOf(config?.baseUrl);
    return { role, configured: !!config, ...(localEmbed ? { model: "lite" } : config ? { model: safeDiagnosticText(config.model) } : {}),
      ...(host ? { host: safeDiagnosticText(host) } : {}),
      ...(role === "chat" ? { thinking: host === "api.deepseek.com" && /^(on|true|1|enabled)$/i.test(process.env.CHAT_THINKING ?? "off") ? "on" as const : "off" as const } : {}) };
  });
}
export async function diagnostics(): Promise<DiagnosticsResponse> {
  let offset = 0;
  let counts: DiagnosticsResponse["db"] = { ok: false, entries: 0, memories: 0, letters: 0, jobs: { running: 0, failed: 0 } };
  try {
    const [entries, memories, letters, running, failed, storedOffset] = await Promise.all([
      db.entry.count(), db.memory.count(), db.letter.count(), db.job.count({ where: { status: "running" } }),
      db.job.count({ where: { status: "failed" } }), getOffset(),
    ]);
    offset = Number.isFinite(storedOffset) ? storedOffset : 0;
    counts = { ok: true, entries, memories, letters, jobs: { running, failed } };
  } catch (error) { logError("diagnostics.db", error); }
  const recent = recentAiCalls();
  const summary = { remote: 0, mock: 0, fallback: 0 };
  for (const call of recent) summary[call.mode]++;
  return { now: new Date(Date.now() + offset).toISOString(), clockOffsetDays: offset / MS_DAY, db: counts, capabilities: capabilities(), recent, summary };
}
const globals = globalThis as unknown as { diagnosticsPingAt?: Map<string, number> };
const pingAt = globals.diagnosticsPingAt ??= new Map<string, number>();
export class PingRateLimitError extends Error {}
export async function pingCapability(role: "chat" | "embed"): Promise<DiagnosticsPingResponse> {
  const at = Date.now();
  if (at - (pingAt.get(role) ?? -Infinity) < 5000) throw new PingRateLimitError();
  pingAt.set(role, at); // 请求开始即占用窗口，未配置/失败也限频，不能并发穿透。
  let execution: ExecutionInfo = { mode: "mock", durationMs: 0, fallbackReason: "not_configured" };
  const options = { timeoutMs: 15_000, purpose: "ping", onExecution: (info: ExecutionInfo) => { execution = info; } };
  if (role === "chat") await chat([{ role: "user", content: "Reply only: ok" }], { ...options, temperature: 0, maxTokens: 16, mock: () => "" });
  else await embed(["ok"], options);
  return { ok: execution.mode === "remote", execution: safeExecution(execution) };
}

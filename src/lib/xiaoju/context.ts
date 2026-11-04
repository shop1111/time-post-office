import { db, parseJson } from "@/lib/db";
import { retrieve } from "@/lib/memory/retrieve";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { sourceRefs, sourcesOfPlan, sourcesValid } from "./memory";

export async function conversationContext(entryId: string, state: string) {
  const entry = await db.entry.findUniqueOrThrow({ where: { id: entryId }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  // The latest user words drive retrieval; older capsule text must not pin a new topic.
  const users = entry.messages.filter((m) => m.role === "user");
  const query = (users.slice(-2).map((m) => m.content).join(" ") || entry.text).slice(-2000);
  const candidates = query.trim().length >= 4 ? (await retrieve({
    query, now: new Date(), excludeEntryId: entryId, k: 6, touch: false,
  })).filter((m) => m.parts.sim >= 0.3 || (m.parts.entity > 0 && m.parts.sim >= 0.15)).slice(0, 4) : [];
  const memories = await db.memory.findMany({ where: { id: { in: candidates.map((m) => m.id) }, ...ACTIVE_MEMORY } });
  const preferences = await db.xiaojuInsight.findMany({ where: { kind: "preference", status: "active" }, orderBy: { createdAt: "desc" }, take: 12 });
  const turns = await db.xiaojuTurn.findMany({ where: { conversation: { entryId }, status: "completed" }, orderBy: { createdAt: "desc" }, take: 30 });
  const refs = [...sourcesOfPlan(state), ...turns.flatMap((t) => sourcesOfPlan(t.plan)), ...preferences.flatMap((p) => sourceRefs(parseJson(p.sourceRefs, [])))];
  const current = await db.memory.findMany({ where: { id: { in: refs.map((r) => r.id) }, ...ACTIVE_MEMORY }, select: { id: true, revision: true } });
  const versions = new Map(current.map((m) => [m.id, m.revision]));
  const validPreferences = preferences.filter((p) => {
    const evidence = sourceRefs(parseJson(p.sourceRefs, []));
    return evidence.length && sourcesValid(evidence, versions);
  }).map((p) => p.content);
  const invalidResponses = new Set(turns.filter((t) => !sourcesValid(sourcesOfPlan(t.plan), versions)).map((t) => `xj-assistant-${t.id}`));
  const recent = [] as Array<{ id: string; role: string; content: string }>;
  let characters = 0;
  for (const message of [...entry.messages].reverse()) {
    if (invalidResponses.has(message.id)) continue;
    if (recent.length >= 30 || (recent.length && characters + message.content.length > 12_000)) break;
    recent.unshift({ id: message.id, role: message.role, content: message.content });
    characters += message.content.length;
  }
  return {
    entry,
    memories,
    data: {
      capsule: { text: entry.text.slice(0, 12_000), textTruncated: entry.text.length > 12_000, caption: entry.visionCaption, place: entry.place, date: entry.occurredAt.toISOString() },
      previousState: sourcesValid(sourcesOfPlan(state), versions) ? parseJson(state, {}) : {},
      preferences: validPreferences,
      conversation: recent,
      candidates: memories.map((m) => ({ id: m.id, content: m.content, date: m.occurredAt.toISOString() })),
    },
  };
}

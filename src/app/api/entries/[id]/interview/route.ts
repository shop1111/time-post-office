import { db } from "@/lib/db";
import { chatStream, type ChatMessage } from "@/lib/ai/provider";
import { interviewSystem } from "@/lib/ai/prompts";
import { mockInterview } from "@/lib/ai/mock";
import { retrieve, formatMemories, fmtDate } from "@/lib/memory/retrieve";
import { getProfile } from "@/lib/memory/profile";
import { now } from "@/lib/clock";

export const runtime = "nodejs";
const MAX_ROUNDS = 3;

/**
 * AI 追问（SSE 流式）。
 * 事件：meta（本轮引用的旧记忆 + 检索打分）→ delta（文本增量）→ done
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { message } = (await req.json().catch(() => ({}))) as { message?: string };
  const entry = await db.entry.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  if (!entry) return new Response("not found", { status: 404 });

  if (message?.trim()) {
    await db.entryMessage.create({ data: { entryId: id, role: "user", content: message.trim() } });
    entry.messages.push({ id: "tmp", entryId: id, role: "user", content: message.trim(), createdAt: new Date() });
  }
  const round = entry.messages.filter((m) => m.role === "assistant").length;
  const t = await now();
  const query = [entry.text, entry.visionCaption, entry.place, message].filter(Boolean).join(" ");
  const related = query
    ? (await retrieve({ query, now: t, k: 3, excludeEntryId: id, entities: entry.place ? [entry.place] : [] })).filter((r) => r.parts.sim > 0.12 || r.parts.entity > 0)
    : [];
  const profile = await getProfile();

  const history: ChatMessage[] = [
    {
      role: "system",
      content: interviewSystem({
        type: entry.type,
        text: entry.text,
        caption: entry.visionCaption,
        place: entry.place,
        date: fmtDate(entry.occurredAt),
        related: formatMemories(related),
        profile: profile.summary,
        round,
        maxRounds: MAX_ROUNDS,
      }),
    },
    ...entry.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];
  if (history.length === 1) history.push({ role: "user", content: "（用户刚寄出这条记录，请你开口）" });

  const lastUser = [...entry.messages].reverse().find((m) => m.role === "user")?.content;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("meta", {
        round,
        maxRounds: MAX_ROUNDS,
        final: round >= MAX_ROUNDS - 1,
        related: related.map((r) => ({ id: r.id, content: r.content, date: r.occurredAt, score: r.score, parts: r.parts, entryId: r.entryId })),
      });
      let full = "";
      try {
        for await (const delta of chatStream(history, {
          temperature: 0.85,
          maxTokens: 300,
          mock: () => mockInterview({ type: entry.type, text: entry.text, place: entry.place, round, maxRounds: MAX_ROUNDS, lastUser, related }),
        })) {
          full += delta;
          send("delta", delta);
        }
        await db.entryMessage.create({ data: { entryId: id, role: "assistant", content: full.trim() } });
        send("done", { final: round >= MAX_ROUNDS - 1 });
      } catch (e) {
        send("error", String(e));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}

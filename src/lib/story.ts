import { z } from "zod";
import { db, parseJson } from "@/lib/db";
import { chatJson } from "@/lib/ai/json";
import { storyMessages, recapMessages } from "@/lib/ai/prompts";
import { mockStory, mockRecap } from "@/lib/ai/mock";
import { styleText, getProfile } from "@/lib/memory/profile";
import { fmtDate } from "@/lib/memory/retrieve";

const StorySchema = z.object({
  title: z.string().min(1).max(30),
  narrative: z.string().min(30).max(600),
  quote: z.string().min(1).max(60),
});

function pickTemplate(e: { type: string; mood: number | null; occurredAt: Date }) {
  if (e.type === "photo") return "postcard";
  if ((e.mood ?? 0) < -0.2) return "night";
  if (e.occurredAt.getHours() >= 20) return "night";
  return (e.mood ?? 0) > 0.4 ? "film" : "paper";
}

export async function generateStoryCard(entryId: string) {
  const entry = await db.entry.findUniqueOrThrow({ where: { id: entryId }, include: { messages: { orderBy: { createdAt: "asc" } } } });
  const conversation = entry.messages.map((m) => `${m.role === "user" ? "我" : "邮差"}：${m.content}`).join("\n");
  const { desc } = await styleText();
  const story = await chatJson(
    StorySchema,
    storyMessages({
      date: fmtDate(entry.occurredAt),
      text: [entry.text, entry.transcript].filter(Boolean).join("。"),
      caption: entry.visionCaption,
      place: entry.place,
      conversation,
      style: desc,
    }),
    {
      temperature: 0.9,
      mock: () =>
        mockStory({
          text: [entry.text, entry.transcript].filter(Boolean).join("。"),
          place: entry.place,
          caption: entry.visionCaption,
          conversation: entry.messages.filter((m) => m.role === "user").map((m) => m.content).join("。"),
          title: entry.title,
        }),
    },
  );
  await db.storyCard.deleteMany({ where: { entryId } });
  return db.storyCard.create({ data: { entryId, ...story, template: pickTemplate(entry) } });
}

export interface RecapPayload {
  month: string;
  title: string;
  narrative: string;
  keywords: string[];
  nextMonthNote: string;
  highlights: Array<{ memoryId: string; line: string; content: string; entryId: string | null; date: string; photoPath: string | null }>;
  stats: {
    count: number;
    byType: Record<string, number>;
    avgMood: number;
    moodSeries: Array<{ day: number; mood: number; title: string }>;
    topPeople: Array<{ name: string; count: number }>;
    topPlaces: Array<{ name: string; count: number }>;
    emotions: Array<{ name: string; count: number }>;
    photos: Array<{ entryId: string; photoPath: string }>;
  };
}

export async function buildRecap(month: string, force = false): Promise<RecapPayload | null> {
  if (!force) {
    const cached = await db.monthlyRecap.findUnique({ where: { month } });
    if (cached) return parseJson<RecapPayload | null>(cached.payload, null);
  }
  const [y, m] = month.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  const entries = await db.entry.findMany({ where: { occurredAt: { gte: start, lt: end } }, orderBy: { occurredAt: "asc" } });
  if (!entries.length) return null;
  const memories = await db.memory.findMany({
    where: { occurredAt: { gte: start, lt: end } },
    include: { entities: { include: { entity: true } } },
    orderBy: [{ importance: "desc" }],
  });

  const tally = (type: string) => {
    const c = new Map<string, number>();
    for (const mem of memories) for (const e of mem.entities) if (e.entity.type === type) c.set(e.entity.name, (c.get(e.entity.name) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count }));
  };
  const emo = new Map<string, number>();
  for (const e of entries) for (const x of parseJson<string[]>(e.emotions, [])) emo.set(x, (emo.get(x) ?? 0) + 1);
  const moods = entries.filter((e) => e.mood !== null);
  const avgMood = moods.length ? moods.reduce((a, e) => a + (e.mood ?? 0), 0) / moods.length : 0;
  const byType: Record<string, number> = {};
  for (const e of entries) byType[e.type] = (byType[e.type] ?? 0) + 1;
  const topPeople = tally("person");
  const topPlaces = tally("place");

  const stats: RecapPayload["stats"] = {
    count: entries.length,
    byType,
    avgMood: Math.round(avgMood * 100) / 100,
    moodSeries: moods.map((e) => ({ day: e.occurredAt.getDate(), mood: e.mood ?? 0, title: e.title ?? "" })),
    topPeople,
    topPlaces,
    emotions: [...emo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, count]) => ({ name, count })),
    photos: entries.filter((e) => e.photoPath).map((e) => ({ entryId: e.id, photoPath: e.photoPath! })),
  };

  const profile = await getProfile();
  const top = memories.slice(0, 14);
  const ai = await chatJson(
    z.object({
      title: z.string().min(1).max(24),
      narrative: z.string().min(40).max(900),
      keywords: z.array(z.string()).max(8).default([]),
      highlights: z.array(z.object({ memoryId: z.string(), line: z.string() })).max(5).default([]),
      nextMonthNote: z.string().max(120).default(""),
    }),
    recapMessages({
      month: `${y}年${m}月`,
      name: profile.name,
      stats: `记录 ${stats.count} 条（${Object.entries(byType).map(([k, v]) => `${k}:${v}`).join("，")}）；平均情绪 ${stats.avgMood}；常见的人：${topPeople.map((p) => p.name).join("、") || "无"}；去过：${topPlaces.map((p) => p.name).join("、") || "无"}；情绪词：${stats.emotions.map((e) => e.name).join("、")}`,
      memories: top.map((x) => `[${x.id}] ${x.occurredAt.getMonth() + 1}/${x.occurredAt.getDate()} ${x.content}（重要度${x.importance}）`).join("\n"),
    }),
    {
      temperature: 0.8,
      maxTokens: 1400,
      mock: () => mockRecap({ month, memories: top, topPeople: topPeople.map((p) => p.name), topPlaces: topPlaces.map((p) => p.name), avgMood, count: entries.length }),
    },
  );

  const byId = new Map(memories.map((x) => [x.id, x]));
  const entryById = new Map(entries.map((e) => [e.id, e]));
  const highlights = ai.highlights
    .filter((h) => byId.has(h.memoryId))
    .map((h) => {
      const mem = byId.get(h.memoryId)!;
      return {
        memoryId: h.memoryId,
        line: h.line,
        content: mem.content,
        entryId: mem.entryId,
        date: mem.occurredAt.toISOString(),
        photoPath: mem.entryId ? (entryById.get(mem.entryId)?.photoPath ?? null) : null,
      };
    });

  const payload: RecapPayload = { month, title: ai.title, narrative: ai.narrative, keywords: ai.keywords, nextMonthNote: ai.nextMonthNote, highlights, stats };
  await db.monthlyRecap.upsert({ where: { month }, update: { payload: JSON.stringify(payload) }, create: { month, payload: JSON.stringify(payload) } });
  return payload;
}

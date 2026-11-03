import { z } from "zod";
import { db, parseJson } from "@/lib/db";
import { chatJson } from "@/lib/ai/json";
import { profileMessages } from "@/lib/ai/prompts";
import { mockProfile } from "@/lib/ai/mock";
import { computeStyle, describeStyle } from "./style";
import type { StyleFingerprint } from "@/lib/types";

export async function getProfile() {
  const p = await db.profile.upsert({ where: { id: "me" }, update: {}, create: { id: "me" } });
  const style = parseJson<StyleFingerprint | null>(p.style, null);
  return {
    ...p,
    traitsList: parseJson<string[]>(p.traits, []),
    styleData: style && "avgSentenceLen" in style ? style : null,
  };
}

export async function styleText(): Promise<{ style: StyleFingerprint | null; desc: string }> {
  const p = await getProfile();
  return { style: p.styleData, desc: p.styleData ? describeStyle(p.styleData) : "自然、口语化" };
}

/** 文风指纹本地重算；画像摘要交给 LLM（Mock 下按实体统计生成） */
export async function refreshProfile() {
  const prev = await getProfile();
  const entries = await db.entry.findMany({ orderBy: { occurredAt: "desc" }, take: 80, include: { messages: { where: { role: "user" } } } });
  const texts = entries.flatMap((e) => [e.text, e.transcript ?? "", ...e.messages.map((m) => m.content)]).filter((t) => t.length > 2);
  const style = computeStyle(texts);

  const memories = await db.memory.findMany({ orderBy: [{ importance: "desc" }, { occurredAt: "desc" }], take: 40, include: { entities: { include: { entity: true } } } });
  const count = (type: string) => {
    const m = new Map<string, number>();
    for (const mem of memories) for (const e of mem.entities) if (e.entity.type === type) m.set(e.entity.name, (m.get(e.entity.name) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  };

  const result = await chatJson(
    z.object({ summary: z.string().min(10).max(400), traits: z.array(z.string().max(12)).min(1).max(8) }),
    profileMessages(memories.map((m) => `${m.occurredAt.toISOString().slice(0, 10)} [${m.kind}] ${m.content}`).join("\n"), prev.summary),
    {
      mock: () =>
        mockProfile({
          name: prev.name,
          people: count("person"),
          places: count("place"),
          goals: memories.filter((m) => m.kind === "goal").map((m) => m.content),
          prefs: memories.filter((m) => m.kind === "preference").map((m) => m.content),
        }),
    },
  );

  await db.profile.update({
    where: { id: "me" },
    data: { summary: result.summary, traits: JSON.stringify(result.traits), style: JSON.stringify(style) },
  });
}

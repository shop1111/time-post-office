import { z } from "zod";
import { db, parseJson } from "@/lib/db";
import { chatJson } from "@/lib/ai/json";
import { profileMessages } from "@/lib/ai/prompts";
import { mockProfile } from "@/lib/ai/mock";
import { computeStyle, describeStyle } from "./style";
import type { StyleFingerprint } from "@/lib/types";
import { assertDerivedRevision, getDerivedRevision, PROFILE_REVISION_KEY } from "./consistency";

export async function getProfile() {
  const { p, revision, built } = await db.$transaction(async (tx) => ({
    p: await tx.profile.upsert({ where: { id: "me" }, update: {}, create: { id: "me" } }),
    revision: await getDerivedRevision(tx),
    built: await tx.setting.findUnique({ where: { key: PROFILE_REVISION_KEY } }),
  }));
  // 从未失效过（版本 0）且没有构建记录：新安装、旧数据或示例数据，画像仍可用；之后以构建版本为准。
  const isStale = built ? built.value !== String(revision) : revision !== 0;
  const style = isStale ? null : parseJson<StyleFingerprint | null>(p.style, null);
  return {
    ...p,
    // Never pass stale summaries or writing samples to a downstream model.
    summary: isStale ? "" : p.summary,
    traits: isStale ? "[]" : p.traits,
    style: isStale ? "{}" : p.style,
    isStale,
    derivedRevision: revision,
    traitsList: isStale ? [] : parseJson<string[]>(p.traits, []),
    styleData: style && "avgSentenceLen" in style ? style : null,
  };
}

export async function styleText(): Promise<{ style: StyleFingerprint | null; desc: string }> {
  const p = await getProfile();
  return { style: p.styleData, desc: p.styleData ? describeStyle(p.styleData) : "自然、口语化" };
}

/** 文风指纹本地重算；画像摘要交给 LLM（Mock 下按实体统计生成） */
export async function refreshProfile() {
  const { profile, entries, memories, revision } = await db.$transaction(async (tx) => ({
    revision: await getDerivedRevision(tx),
    profile: await tx.profile.upsert({ where: { id: "me" }, update: {}, create: { id: "me" } }),
    // Raw text from corrected/retracted sources may contain superseded facts.
    // Exclude those sources from verbatim writing samples as well.
    entries: await tx.entry.findMany({
      where: { memories: { some: { status: "active" }, none: { OR: [{ status: "retracted" }, { userEdited: true }] } } },
      orderBy: { occurredAt: "desc" }, take: 80,
      include: { messages: { where: { role: "user" } } },
    }),
    memories: await tx.memory.findMany({
      where: { status: "active" },
      orderBy: [{ importance: "desc" }, { occurredAt: "desc" }], take: 40,
      include: { entities: { include: { entity: true } } },
    }),
  }));
  const texts = entries.flatMap((e) => [e.text, e.transcript !== e.text ? e.transcript ?? "" : "", ...e.messages.map((m) => m.content)]).filter((t) => t.length > 2);
  const style = computeStyle(texts);

  const count = (type: string) => {
    const m = new Map<string, number>();
    for (const mem of memories) for (const e of mem.entities) if (e.entity.type === type) m.set(e.entity.name, (m.get(e.entity.name) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  };

  const result = memories.length ? await chatJson(
    z.object({ summary: z.string().min(10).max(400), traits: z.array(z.string().max(12)).min(1).max(8) }),
    profileMessages(memories.map((m) => `${m.occurredAt.toISOString().slice(0, 10)} [${m.kind}] ${m.content}`).join("\n"), ""),
    {
      mock: () =>
        mockProfile({
          name: profile.name,
          people: count("person"),
          places: count("place"),
          goals: memories.filter((m) => m.kind === "goal").map((m) => m.content),
          prefs: memories.filter((m) => m.kind === "preference").map((m) => m.content),
        }),
    },
  ) : { summary: "还没有可用于画像的有效记忆。你可以继续放胶囊，小局会慢慢认识你。", traits: [] };

  await db.$transaction(async (tx) => {
    await assertDerivedRevision(tx, revision);
    await tx.profile.update({
      where: { id: "me" },
      data: { summary: result.summary, traits: JSON.stringify(result.traits), style: JSON.stringify(style) },
    });
    await tx.setting.upsert({
      where: { key: PROFILE_REVISION_KEY },
      create: { key: PROFILE_REVISION_KEY, value: String(revision) },
      update: { value: String(revision) },
    });
  });
  return { derivedRevision: revision };
}

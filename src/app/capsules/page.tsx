import Link from "next/link";
import { ArrowRight, Mic, PenLine, Camera, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { now } from "@/lib/clock";
import { CAPSULE_WHERE } from "@/lib/capsules";
import { StoryCard } from "@/components/StoryCard";
import { cn, fmtCN, monthKey, moodColor, moodEmoji, photoUrl } from "@/lib/utils";

export default async function Capsules({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  const { tag } = await searchParams;
  const t = await now();
  const visibleCapsules = { ...CAPSULE_WHERE, occurredAt: { lte: t } };
  const [entries, entities] = await Promise.all([
    db.entry.findMany({
      where: {
        ...visibleCapsules,
        ...(tag ? { memories: { some: { ...ACTIVE_MEMORY, entities: { some: { entity: { name: tag } } } } } } : {}),
      },
      orderBy: { occurredAt: "desc" },
      include: { cards: true },
    }),
    db.entity.findMany({
      where: { type: { in: ["person", "place"] } },
      include: {
        memories: {
          where: { memory: { ...ACTIVE_MEMORY, entry: visibleCapsules } },
          select: { memory: { select: { entryId: true } } },
        },
      },
    }),
  ]);
  const tags = entities
    .map((e) => ({ ...e, capsuleCount: new Set(e.memories.map(({ memory }) => memory.entryId)).size }))
    .filter((e) => e.capsuleCount >= 2)
    .sort((a, b) => b.capsuleCount - a.capsuleCount)
    .slice(0, 12);

  const months = new Map<string, typeof entries>();
  for (const e of entries) {
    const k = monthKey(e.occurredAt);
    months.set(k, [...(months.get(k) ?? []), e]);
  }

  return (
    <div className="space-y-8">
      <header>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-hand text-3xl">胶囊</h1>
            <p className="mt-1 max-w-xl text-sm leading-6 text-ink-2">你放进时光邮局的生活点滴，按时间排好。照片、语音、文字都算，小局会帮你把每一天整理成故事卡片。</p>
          </div>
          <Link href="/capsules/new" className="btn btn-primary">
            <Plus size={15} /> 放一颗胶囊
          </Link>
        </div>
        <div className="scrollbar-none -mx-4 mt-4 flex gap-2 overflow-x-auto px-4">
          <Link href="/capsules" className={cn("chip shrink-0 !py-1", !tag && "!bg-stamp !text-white")}>
            全部
          </Link>
          {tags.map((e) => (
            <Link key={e.id} href={`/capsules?tag=${encodeURIComponent(e.name)}`} className={cn("chip shrink-0 !py-1", tag === e.name && "!bg-stamp !text-white")}>
              {e.type === "person" ? "👤" : "📍"} {e.name} <span className="opacity-60">{e.capsuleCount}</span>
            </Link>
          ))}
        </div>
      </header>

      {entries.length === 0 && <p className="text-ink-3">这里还空空的，放第一颗胶囊吧。</p>}

      {[...months.entries()].map(([m, list]) => {
        const [y, mm] = m.split("-");
        return (
          <section key={m}>
            <div className="sticky top-14 z-10 -mx-4 mb-4 flex items-end justify-between bg-paper/90 px-4 py-2 backdrop-blur">
              <div>
                <span className="font-hand text-2xl">{Number(mm)}月</span>
                <span className="ml-2 text-sm text-ink-3">{y} · {list.length} 颗</span>
                <span className="ml-3 inline-flex gap-0.5 align-middle">
                  {[...list].reverse().map((e) => (
                    <span key={e.id} className="inline-block h-3 w-1.5 rounded-full" style={{ background: moodColor(e.mood) }} title={e.title ?? ""} />
                  ))}
                </span>
              </div>
              <Link href={`/recap/${m}`} className="flex items-center gap-1 rounded-full bg-gold/15 px-3 py-1 text-xs text-ink hover:bg-gold/25">
                月度回忆 <ArrowRight size={12} />
              </Link>
            </div>
            <div className="columns-1 gap-4 sm:columns-2">
              {list.map((e) => {
                const card = e.cards[0];
                const Icon = e.type === "photo" ? Camera : e.type === "voice" ? Mic : PenLine;
                return (
                  <Link key={e.id} href={`/capsules/${e.id}`} className="mb-4 block break-inside-avoid transition hover:-translate-y-0.5">
                    {card ? (
                      <StoryCard compact c={{ ...card, date: e.occurredAt.toISOString(), place: e.place, photoPath: e.photoPath }} />
                    ) : (
                      <div className="card p-4">
                        <div className="flex items-center gap-2 text-xs text-ink-3">
                          <Icon size={12} /> {fmtCN(e.occurredAt, false)} {e.place && `· ${e.place}`} <span className="ml-auto">{moodEmoji(e.mood)}</span>
                        </div>
                        {e.photoPath && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photoUrl(e.photoPath)!} alt="" className="mt-2 h-40 w-full rounded-lg object-cover" />
                        )}
                        <div className="mt-2 font-hand text-lg">{e.title ?? "未整理的一天"}</div>
                        <p className="mt-1 line-clamp-3 text-sm leading-6 text-ink-2">{e.text}</p>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

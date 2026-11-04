import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MapPin, Mic, Camera, PenLine } from "lucide-react";
import { db, parseJson } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { now } from "@/lib/clock";
import { retrieve } from "@/lib/memory/retrieve";
import { StoryCard } from "@/components/StoryCard";
import { EntryActions } from "@/components/EntryActions";
import { ScoreBreakdown } from "@/components/memory/ScoreBreakdown";
import { fmtCN, fmtTime, photoUrl, moodEmoji } from "@/lib/utils";
import { KIND_LABEL, type MemoryKind } from "@/lib/types";

export default async function CapsulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = await db.entry.findUnique({
    where: { id },
    include: { messages: { orderBy: { createdAt: "asc" } }, memories: { where: ACTIVE_MEMORY, include: { entities: { include: { entity: true } } } }, cards: true },
  });
  if (!entry) notFound();
  const t = await now();
  const related = entry.summary || entry.text
    ? (await retrieve({ query: `${entry.summary ?? ""} ${entry.text}`, now: t, k: 4, excludeEntryId: id, touch: false, entities: entry.memories.flatMap((m) => m.entities.map((e) => e.entity.name)) })).filter(
        // 与追问时的过滤一致：只是「最近」或「重要」但内容无关的记忆不算想起
        (r) => r.parts.sim > 0.12 || r.parts.entity > 0,
      )
    : [];
  const card = entry.cards[0];
  const emotions = parseJson<string[]>(entry.emotions, []);
  const TypeIcon = entry.type === "photo" ? Camera : entry.type === "voice" ? Mic : PenLine;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/capsules" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft size={14} /> 胶囊
      </Link>

      <header>
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-3">
          <TypeIcon size={14} />
          <span>{fmtCN(entry.occurredAt)} {fmtTime(entry.occurredAt)}</span>
          {entry.place && (
            <span className="flex items-center gap-0.5">
              <MapPin size={13} /> {entry.place}
            </span>
          )}
          <span>{moodEmoji(entry.mood)}</span>
          {emotions.map((e) => (
            <span key={e} className="chip">
              {e}
            </span>
          ))}
        </div>
        <h1 className="mt-2 font-hand text-3xl">{entry.title ?? "未命名的一天"}</h1>
      </header>

      {entry.photoPath && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl(entry.photoPath)!} alt={entry.title ?? ""} className="max-h-[480px] w-full rounded-2xl object-cover shadow-[var(--shadow)]" />
      )}
      {entry.visionCaption && <p className="-mt-3 text-xs text-ink-3">👁 小局看到的画面：{entry.visionCaption}</p>}

      {entry.text && <p className="letter-paper rounded-2xl border border-line px-6 py-3 font-hand text-lg">{entry.text}</p>}

      {entry.messages.length > 0 && (
        <section className="card p-5">
          <h2 className="font-hand text-lg">和小局的对话</h2>
          <div className="mt-3 space-y-2.5">
            {entry.messages.map((m) => (
              <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
                <span className={`inline-block max-w-[85%] rounded-2xl px-3.5 py-2 text-left text-sm leading-6 ${m.role === "user" ? "bg-stamp text-white" : "bg-paper-2"}`}>{m.content}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {card && (
        <section>
          <h2 className="mb-3 font-hand text-xl">故事卡片</h2>
          <StoryCard exportable c={{ ...card, date: entry.occurredAt.toISOString(), place: entry.place, photoPath: entry.photoPath }} />
        </section>
      )}

      {entry.memories.length > 0 && (
        <section className="card p-5">
          <h2 className="font-hand text-lg">小局从这天记住的事</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {entry.memories.map((m) => (
              <li key={m.id} className="flex gap-2">
                <span className="mt-0.5 h-fit shrink-0 rounded bg-post-soft px-1.5 text-[11px] text-post">{KIND_LABEL[m.kind as MemoryKind]}</span>
                <span>
                  {m.content}
                  {m.entities.map((e) => (
                    <span key={e.entityId} className="ml-1.5 text-xs text-ink-3">
                      #{e.entity.name}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section>
          <h2 className="mb-3 font-hand text-xl">这让小局想起</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {related.map((r) => (
              <Link key={r.id} href={r.entryId ? `/capsules/${r.entryId}` : "/memory"} className="card block p-4 transition hover:-translate-y-0.5">
                <div className="text-xs text-ink-3">{fmtCN(r.occurredAt)}</div>
                <p className="mt-1 text-sm">{r.content}</p>
                <ScoreBreakdown compact className="mt-3" parts={r.parts} score={r.score} />
              </Link>
            ))}
          </div>
        </section>
      )}

      <EntryActions id={entry.id} hasCard={!!card} />
    </div>
  );
}

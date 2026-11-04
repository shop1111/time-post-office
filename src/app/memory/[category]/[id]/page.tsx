import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BookOpen, CalendarDays, ChevronRight, Flower2, Heart, MoreHorizontal } from "lucide-react";
import { db } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { categoryItems, findCategory, mapDate } from "@/lib/memory/map";

import { photoUrl } from "@/lib/utils";

export default async function MemoryDetailPage({ params }: { params: Promise<{ category: string; id: string }> }) {
  const { category: categoryId, id } = await params;
  const category = findCategory(categoryId);
  if (!category) notFound();
  const memories = await db.memory.findMany({ where: ACTIVE_MEMORY,
    include: { entities: { include: { entity: true } }, entry: { include: { messages: { where: { role: "user" }, orderBy: { createdAt: "asc" } } } } },
  });
  const item = categoryItems(category.id, memories).find((item) => item.id === id);
  if (!item) notFound();
  const ids = new Set(item.memories.map((memory) => memory.id));
  const related = memories.filter((memory) => ids.has(memory.id));
  const entries = [...new Map(related.flatMap((memory) => memory.entry ? [[memory.entry.id, memory.entry] as const] : [])).values()]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const photos = entries.filter((entry) => entry.photoPath);
  const goal = category.id === "goals" ? item.memories[0] : null;

  return <article className="mx-auto max-w-5xl space-y-6">
    <div className="flex items-center justify-between"><Link href={`/memory/${category.id}`} className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink"><ArrowLeft size={14} /> 返回{category.title}</Link>
      <details className="relative"><summary aria-label="记忆操作" className="cursor-pointer list-none rounded-full p-2 hover:bg-paper-2"><MoreHorizontal size={21} /></summary><div className="card absolute right-0 z-10 w-40 p-2"><Link href="/memory/manage" className="block rounded-lg px-3 py-2 text-sm hover:bg-paper-2">更正或撤回记忆</Link></div></details>
    </div>
    <header>

      <div className="min-w-0"><h1 className="font-hand text-3xl">{item.title}</h1>
        <div className="mt-3 flex flex-wrap gap-2"><span className="chip"><Heart size={12} /> {item.memories.length} 条归纳</span><span className="chip"><CalendarDays size={12} /> 最近提及 {mapDate(item.latest)}</span>
          {goal && <span className="chip">{goal.resolved ? "已完成" : "进行中"}</span>}
          {goal?.dueAt && <span className="chip">截止 {mapDate(goal.dueAt)}</span>}
        </div>
      </div>
    </header>
    {goal && <div className="mb-6 flex items-center gap-4 text-sm"><span className="text-ink-2">计划状态</span><span className={`chip ${goal.resolved ? "!bg-post-soft !text-post" : ""}`}>{goal.resolved ? "已完成" : "正在努力中"}</span></div>}
    <section className="card p-5">
      <h2 className="flex items-center gap-2 font-hand text-lg"><BookOpen size={16} className="text-gold" /> 小局的记录</h2>
      <p className="mt-1 text-xs text-ink-3">根据有效记忆整理{related.some((memory) => memory.userEdited) ? " · 含你更正的内容" : ""}</p>
      <ul className="mt-3 space-y-3 text-sm leading-7">{item.memories.map((memory) => <li key={memory.id}>{memory.content}</li>)}</ul>
      {item.themes.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{item.themes.map((theme) => <span className="chip justify-center text-center leading-5" key={theme}>{theme}</span>)}</div>}
    </section>
    <section className="pt-2">
      <div className="mb-5 flex items-center gap-4"><Flower2 size={32} strokeWidth={1.2} className="shrink-0 text-gold/65" /><div className="border-l border-line pl-4"><h2 className="flex items-baseline gap-3 font-hand text-2xl">相关记忆 <span className="text-base font-normal text-ink-3">{entries.length} 条</span></h2><p className="mt-1 text-sm text-ink-2">你留下的原始记录</p></div></div>
      {category.id === "places" && photos.length > 0 && <div className="mt-4 grid grid-cols-3 gap-3">{photos.slice(0, 6).map((entry) => <Link href={`/capsules/${entry.id}`} key={entry.id}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photoUrl(entry.photoPath)!} alt="记录中的照片" className="aspect-[16/10] w-full rounded-xl object-cover" />
      </Link>)}</div>}
      <ol className="mt-4 space-y-4">{entries.map((entry) => {
        // Never substitute Entry.summary, visionCaption or Memory.content for the user's original words.
        const original = entry.text || entry.transcript || entry.messages.map((message) => message.content).join("\n");
        const title = original.trim().split(/(?<=[。！？!?])|\n/u)[0]?.slice(0, 96) || (entry.photoPath ? "一张生活照片" : entry.audioPath ? "一段语音记录" : "生活记录");
        const tags = [...new Set(memories.filter((memory) => memory.entryId === entry.id).flatMap((memory) => memory.entities.map(({ entity }) => entity.name)))].slice(0, 5);
        return <li key={entry.id} className="memory-source"><Link href={`/capsules/${entry.id}`} className="card group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 p-5 transition-colors hover:border-gold/50 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-5 sm:p-6">
          <div className="col-span-2 sm:col-span-1 sm:self-start sm:border-r sm:border-line sm:pr-5"><time dateTime={entry.occurredAt.toISOString()} className="inline-block -rotate-2 rounded-md border border-line bg-paper px-3 py-1.5 text-xs leading-6 text-ink-2 shadow-sm sm:whitespace-nowrap">{mapDate(entry.occurredAt)}</time></div>
          <div className="min-w-0"><h3 className="line-clamp-2 text-base font-semibold leading-7 group-hover:text-stamp sm:text-lg">{title}</h3><p className="mt-2 line-clamp-2 whitespace-pre-line text-sm leading-6 text-ink-2">{original || "打开查看这段生活记录。"}</p>{tags.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{tags.map((tag) => <span key={tag} className="chip !bg-stamp-soft !text-stamp">{tag}</span>)}</div>}</div>
          <div className="flex items-center gap-4">{entry.photoPath && <span className="relative hidden shrink-0 -rotate-3 rounded-lg border border-line bg-card p-1 shadow-sm md:block"><span className="absolute -top-2 left-1/3 h-4 w-10 -rotate-6 bg-paper-2/80" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl(entry.photoPath)!} alt="记录中的照片" className="h-24 w-28 rounded object-cover" />
          </span>}<ChevronRight size={20} className="shrink-0 text-ink-3 group-hover:text-ink" /></div>
        </Link></li>;
      })}</ol>
      {entries.length === 0 && <p className="py-8 text-center text-sm text-ink-3">这条归纳暂时没有关联的原始记录。</p>}
    </section>
  </article>;
}


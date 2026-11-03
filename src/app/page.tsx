import Link from "next/link";
import { Camera, Mic, PenLine, ArrowRight, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { getProfile } from "@/lib/memory/profile";
import { Envelope } from "@/components/Envelope";
import { StoryCard } from "@/components/StoryCard";
import { Onboarding } from "@/components/Onboarding";
import { daysBetween, fmtCN, photoUrl, moodEmoji } from "@/lib/utils";

function greeting(h: number) {
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

export default async function Home() {
  const t = await now();
  const [profile, entryCount, memoryCount, letters, transit, cards, all] = await Promise.all([
    getProfile(),
    db.entry.count(),
    db.memory.count(),
    db.letter.findMany({ where: { deliveredAt: { not: null }, readAt: null }, orderBy: { deliveredAt: "desc" }, take: 6 }),
    db.letter.count({ where: { deliveredAt: null } }),
    db.storyCard.findMany({ orderBy: { entry: { occurredAt: "desc" } }, take: 4, include: { entry: true } }),
    db.entry.findMany({ where: { occurredAt: { lte: t } }, select: { id: true, occurredAt: true, title: true, summary: true, photoPath: true, mood: true, text: true } }),
  ]);

  if (entryCount === 0) return <Onboarding />;

  // 往日回响：N 个月前的同一天，没有就挑一条最重要的旧时光
  const echoes = all
    .filter((e) => daysBetween(e.occurredAt, t) >= 25 && Math.abs(e.occurredAt.getDate() - t.getDate()) <= 1)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, 2);
  const firstDay = all.reduce((m, e) => (e.occurredAt < m ? e.occurredAt : m), t);
  const days = daysBetween(firstDay, t) + 1;

  return (
    <div className="space-y-8">
      {/* 问候 */}
      <section className="pt-2">
        <div className="text-sm text-ink-3">{fmtCN(t)} · 认识你的第 {days} 天</div>
        <h1 className="mt-1 font-hand text-3xl md:text-4xl">
          {greeting(t.getHours())}，{profile.name}。
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-7 text-ink-2">
          {letters.length ? `有 ${letters.length} 封信在等你拆开。` : "今天还没有新的信。"}
          {transit ? `另有 ${transit} 封信正在路上。` : ""}
          想记下点什么吗？一张照片、一段话都可以。
        </p>
      </section>

      {/* 快捷记录 */}
      <section className="grid grid-cols-3 gap-3">
        {[
          { href: "/record?type=photo", icon: Camera, label: "寄一张照片", sub: "AI 会问你那天的故事" },
          { href: "/record?type=voice", icon: Mic, label: "说一段话", sub: "边说边转文字" },
          { href: "/record?type=text", icon: PenLine, label: "写一篇日记", sub: "长短都好" },
        ].map(({ href, icon: Icon, label, sub }) => (
          <Link key={href} href={href} className="card group flex flex-col items-start gap-2 p-4 transition hover:-translate-y-0.5">
            <span className="rounded-full bg-stamp-soft p-2 text-stamp transition group-hover:scale-110">
              <Icon size={20} />
            </span>
            <span className="text-sm font-medium md:text-base">{label}</span>
            <span className="hidden text-xs text-ink-3 sm:block">{sub}</span>
          </Link>
        ))}
      </section>

      {/* 未读来信 */}
      {letters.length > 0 && (
        <section>
          <SectionTitle title="待拆的信" href="/mailbox" more="全部信件" />
          <div className="grid gap-3 sm:grid-cols-2">
            {letters.map((l, i) => (
              <Envelope key={l.id} index={i} l={{ ...l, deliveredAt: l.deliveredAt?.toISOString() ?? null, scheduledAt: l.scheduledAt.toISOString(), readAt: null, writtenAt: l.writtenAt.toISOString() }} />
            ))}
          </div>
        </section>
      )}

      {/* 往日回响 */}
      {echoes.length > 0 && (
        <section>
          <SectionTitle title="往日回响" />
          <div className="grid gap-3 sm:grid-cols-2">
            {echoes.map((e) => {
              const months = Math.round(daysBetween(e.occurredAt, t) / 30);
              return (
                <Link key={e.id} href={`/entry/${e.id}`} className="card flex gap-4 overflow-hidden p-3 transition hover:-translate-y-0.5">
                  {e.photoPath ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoUrl(e.photoPath)!} alt="" className="h-24 w-24 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-paper-2 text-3xl">{moodEmoji(e.mood)}</div>
                  )}
                  <div className="min-w-0 py-1">
                    <div className="text-xs text-gold">{months >= 12 ? `${Math.round(months / 12)} 年前的今天` : `${months} 个月前的今天`}</div>
                    <div className="mt-1 font-hand text-lg">{e.title}</div>
                    <p className="mt-1 line-clamp-2 text-sm text-ink-2">{e.summary ?? e.text}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* 最近的故事 */}
      {cards.length > 0 && (
        <section>
          <SectionTitle title="最近的故事卡片" href="/timeline" more="时间线" />
          <div className="grid gap-4 sm:grid-cols-2">
            {cards.map((c) => (
              <Link key={c.id} href={`/entry/${c.entryId}`} className="block transition hover:-translate-y-0.5">
                <StoryCard compact c={{ ...c, date: c.entry.occurredAt.toISOString(), place: c.entry.place, photoPath: c.entry.photoPath }} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* AI 眼中的你 */}
      <section className="card flex flex-col gap-3 p-5 md:flex-row md:items-center">
        <Sparkles className="shrink-0 text-gold" />
        <div className="flex-1">
          <div className="text-xs text-ink-3">
            邮差已经记住了 {memoryCount} 件关于你的事 · {entryCount} 段生活
          </div>
          <p className="mt-1 text-[15px] leading-7">{profile.summary || "还在慢慢认识你。多寄几封生活的信吧。"}</p>
        </div>
        <Link href="/memory" className="btn btn-ghost self-start md:self-center">
          记忆宫殿 <ArrowRight size={14} />
        </Link>
      </section>
    </div>
  );
}

function SectionTitle({ title, href, more }: { title: string; href?: string; more?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between">
      <h2 className="font-hand text-xl">{title}</h2>
      {href && (
        <Link href={href} className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
          {more} <ArrowRight size={12} />
        </Link>
      )}
    </div>
  );
}

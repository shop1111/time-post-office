import Link from "next/link";
import { Camera, Mic, PenLine, ArrowRight, Package, Mail } from "lucide-react";
import { db } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { now } from "@/lib/clock";
import { getProfile } from "@/lib/memory/profile";
import { CAPSULE_WHERE } from "@/lib/capsules";
import { INBOX_WHERE, toEnvelope } from "@/lib/letter-dto";
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
  const [profile, capsuleCount, letterCount, memoryCount, letters, cards, all] = await Promise.all([
    getProfile(),
    db.entry.count({ where: CAPSULE_WHERE }),
    db.letter.count(),
    db.memory.count({ where: ACTIVE_MEMORY }),
    db.letter.findMany({ where: { ...INBOX_WHERE, readAt: null }, orderBy: { deliveredAt: "desc" }, take: 6, include: { correspondent: true } }),
    db.storyCard.findMany({ orderBy: { entry: { occurredAt: "desc" } }, take: 4, include: { entry: true } }),
    db.entry.findMany({ where: { ...CAPSULE_WHERE, occurredAt: { lte: t } }, select: { id: true, occurredAt: true, title: true, summary: true, photoPath: true, mood: true, text: true } }),
  ]);

  if (capsuleCount === 0 && letterCount === 0) return <Onboarding />;

  // 以前的今天：几个月前同一天（±1 天）放进来的胶囊
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
        <div className="text-sm text-ink-3">{fmtCN(t)} · 小局认识你的第 {days} 天</div>
        <h1 className="mt-1 font-hand text-3xl md:text-4xl">
          {greeting(t.getHours())}，{profile.name}。
        </h1>
        <p className="mt-2 max-w-2xl text-[15px] leading-7 text-ink-2">
          {letters.length ? `有 ${letters.length} 封信在等你拆开。` : "今天还没有新的信。"}
          想记下点什么，就放一颗胶囊；想对谁说点什么，就写一封信。
        </p>
      </section>

      {/* 两条主线：胶囊 / 邮件 */}
      <section className="grid gap-3 md:grid-cols-2">
        <div className="card flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-stamp-soft p-2 text-stamp">
              <Package size={20} />
            </span>
            <div>
              <div className="font-hand text-xl">放一颗胶囊</div>
              <div className="text-xs text-ink-3">记下生活里的点滴，小局会问问你那天的故事</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { href: "/capsules/new?type=photo", icon: Camera, label: "照片" },
              { href: "/capsules/new?type=voice", icon: Mic, label: "语音" },
              { href: "/capsules/new?type=text", icon: PenLine, label: "文字" },
            ].map(({ href, icon: Icon, label }) => (
              <Link key={href} href={href} className="flex flex-col items-center gap-1 rounded-xl border border-line py-3 text-sm transition hover:-translate-y-0.5 hover:bg-paper-2">
                <Icon size={18} className="text-stamp" />
                {label}
              </Link>
            ))}
          </div>
        </div>
        <Link href="/mail/write" className="card group flex flex-col gap-3 p-5 transition hover:-translate-y-0.5">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-post-soft p-2 text-post">
              <Mail size={20} />
            </span>
            <div>
              <div className="font-hand text-xl">写一封信</div>
              <div className="text-xs text-ink-3">写给某个人、未来的自己，或者平行时空的自己</div>
            </div>
          </div>
          <p className="text-sm leading-6 text-ink-2">比如写给某个瞬间帮过你的人，TA 会在一天之内回信；写给未来的自己，到了那天你会收到。</p>
          <span className="mt-auto flex items-center gap-1 text-sm text-post">
            去写信 <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
          </span>
        </Link>
      </section>

      {/* 未读来信 */}
      {letters.length > 0 && (
        <section>
          <SectionTitle title="待拆的信" href="/mail" more="全部邮件" />
          <div className="grid gap-3 sm:grid-cols-2">
            {letters.map((l, i) => (
              <Envelope key={l.id} index={i} l={toEnvelope(l)} />
            ))}
          </div>
        </section>
      )}

      {/* 以前的今天 */}
      {echoes.length > 0 && (
        <section>
          <SectionTitle title="以前的今天" sub="几个月前的同一天，你放进来的胶囊" />
          <div className="grid gap-3 sm:grid-cols-2">
            {echoes.map((e) => {
              const months = Math.round(daysBetween(e.occurredAt, t) / 30);
              return (
                <Link key={e.id} href={`/capsules/${e.id}`} className="card flex gap-4 overflow-hidden p-3 transition hover:-translate-y-0.5">
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

      {/* 最近的胶囊 */}
      {cards.length > 0 && (
        <section>
          <SectionTitle title="最近的胶囊" sub="每颗胶囊整理好后，小局会把那一天写成一张故事卡片" href="/capsules" more="全部胶囊" />
          <div className="grid gap-4 sm:grid-cols-2">
            {cards.map((c) => (
              <Link key={c.id} href={`/capsules/${c.entryId}`} className="block transition hover:-translate-y-0.5">
                <StoryCard compact c={{ ...c, date: c.entry.occurredAt.toISOString(), place: c.entry.place, photoPath: c.entry.photoPath }} />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 小局眼中的你 */}
      <section className="card flex flex-col gap-3 p-5 md:flex-row md:items-center">
        <span className="shrink-0 text-2xl">📮</span>
        <div className="flex-1">
          <div className="text-xs text-ink-3">
            小局眼中的你 · 记住了 {memoryCount} 件事 · {capsuleCount} 颗胶囊
          </div>
          <p className="mt-1 text-[15px] leading-7">{profile.summary || "还在慢慢认识你。多放几颗胶囊吧。"}</p>
        </div>
        <Link href="/memory" className="btn btn-ghost self-start md:self-center">
          查看记忆 <ArrowRight size={14} />
        </Link>
      </section>
    </div>
  );
}

function SectionTitle({ title, sub, href, more }: { title: string; sub?: string; href?: string; more?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="font-hand text-xl">{title}</h2>
        {sub && <p className="text-xs text-ink-3">{sub}</p>}
      </div>
      {href && (
        <Link href={href} className="flex shrink-0 items-center gap-1 text-xs text-ink-3 hover:text-ink">
          {more} <ArrowRight size={12} />
        </Link>
      )}
    </div>
  );
}

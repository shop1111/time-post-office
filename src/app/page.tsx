import { XiaojuImage } from "@/components/XiaojuImage";
import Link from "next/link";
import { Camera, Mic, PenLine, ArrowRight, Package, Mail } from "lucide-react";
import { db } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { now } from "@/lib/clock";
import { getProfile } from "@/lib/memory/profile";
import { CAPSULE_WHERE } from "@/lib/capsules";
import { INBOX_WHERE, toEnvelope } from "@/lib/letter-dto";
import { HeroEnvelope } from "@/components/HeroEnvelope";
import { StoryCard } from "@/components/StoryCard";
import { Onboarding } from "@/components/Onboarding";
import { cn, daysBetween, fmtCN } from "@/lib/utils";

/** 首页只放最新一封未拆的信当主角，其余的在信封上提示数量 */
const HOME_LETTERS = 1;
/** 最近的胶囊锁死一行两张，保证首页一屏看完 */
const HOME_CARDS = 2;

function greeting(h: number) {
  if (h < 5) return "夜深了";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

export default async function Home() {
  const t = await now();
  const [profile, capsuleCount, letterCount, memoryCount, unreadCount, letters, cards, all] = await Promise.all([
    getProfile(),
    db.entry.count({ where: CAPSULE_WHERE }),
    db.letter.count(),
    db.memory.count({ where: ACTIVE_MEMORY }),
    db.letter.count({ where: { ...INBOX_WHERE, readAt: null } }),
    // 首页每个区块限量，保证高度固定、不随数据变长；其余去二级页看
    db.letter.findMany({ where: { ...INBOX_WHERE, readAt: null }, orderBy: { deliveredAt: "desc" }, take: HOME_LETTERS, include: { correspondent: true } }),
    db.storyCard.findMany({ orderBy: { entry: { occurredAt: "desc" } }, take: HOME_CARDS, include: { entry: true } }),
    db.entry.findMany({ where: { ...CAPSULE_WHERE, occurredAt: { lte: t } }, select: { occurredAt: true } }),
  ]);

  if (capsuleCount === 0 && letterCount === 0) return <Onboarding />;

  const firstDay = all.reduce((m, e) => (e.occurredAt < m ? e.occurredAt : m), t);
  const days = daysBetween(firstDay, t) + 1;

  return (
    <div className="space-y-6">
      {/* 问候 */}
      <section className="flex items-center justify-between gap-3 pt-2 sm:gap-6">
        <div className="min-w-0">
          <div className="text-sm text-ink-3">{fmtCN(t)} · 小局认识你的第 {days} 天</div>
          <h1 className="mt-1 font-hand text-3xl md:text-4xl">
            {greeting(t.getHours())}，{profile.name}。
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-7 text-ink-2">
            {unreadCount
              ? `有 ${unreadCount} 封信在等你拆开。`
              : "今天还没有新的信。想记下点什么，就放一颗胶囊；想对谁说点什么，就写一封信。"}
          </p>
        </div>
        <div className="flex shrink-0 items-end gap-3 self-end">
          {/* 桌面端：小局的自我介绍 */}
          <div className="mb-6 hidden border-r-2 border-stamp/40 pr-3 text-right md:block">
            <div className="font-hand text-xl">小局</div>
            <div className="mt-0.5 text-xs tracking-widest text-stamp">时光邮局局长</div>
            <div className="mt-1 text-xs text-ink-3">帮你收好每一天，也替你送每一封信</div>
          </div>
          <XiaojuImage scene="home" className="h-24 w-20 sm:h-36 sm:w-36 md:h-44 md:w-44" />
        </div>
      </section>

      {/* 有未拆的信：信封是主角，右侧上下叠放胶囊 / 写信；没有：放胶囊是主角 */}
      <section className="grid gap-3 md:grid-cols-[3fr_2fr]">
        {letters[0] ? (
          <>
            <HeroEnvelope l={toEnvelope(letters[0])} more={unreadCount - 1} />
            <div className="grid gap-3 md:grid-rows-2">
              <CapsuleCard compact />
              <WriteCard />
            </div>
          </>
        ) : (
          <>
            <CapsuleCard />
            <WriteCard />
          </>
        )}
      </section>

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
      <section className="card flex flex-col gap-3 p-5 md:flex-row md:items-center md:py-4">
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

const CAPSULE_TYPES = [
  { href: "/capsules/new?type=photo", icon: Camera, label: "照片" },
  { href: "/capsules/new?type=voice", icon: Mic, label: "语音" },
  { href: "/capsules/new?type=text", icon: PenLine, label: "文字" },
];

/** compact：放在信封右侧的半格高度，按钮改成图标和文字一行 */
function CapsuleCard({ compact }: { compact?: boolean }) {
  return (
    <div className={cn("card flex flex-col", compact ? "justify-center gap-2.5 p-4" : "gap-3 p-5")}>
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-full bg-stamp-soft p-2 text-stamp">
          <Package size={compact ? 18 : 20} />
        </span>
        <div className="min-w-0">
          <div className="font-hand text-xl">放一颗胶囊</div>
          {!compact && <div className="text-xs text-ink-3">记下生活里的点滴，小局会问问你那天的故事</div>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {CAPSULE_TYPES.map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center justify-center rounded-xl border border-line text-sm transition hover:-translate-y-0.5 hover:bg-paper-2",
              compact ? "gap-1.5 py-2" : "flex-col gap-1 py-3",
            )}
          >
            <Icon size={compact ? 16 : 18} className="text-stamp" />
            {label}
          </Link>
        ))}
      </div>
    </div>
  );
}

function WriteCard() {
  return (
    <Link href="/mail/write" className="card group flex items-center gap-3 p-4 transition hover:-translate-y-0.5 md:p-5">
      <span className="shrink-0 rounded-full bg-post-soft p-2 text-post">
        <Mail size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-hand text-xl">写一封信</div>
        <div className="text-xs text-ink-3">写给某个人、未来的自己，或者平行时空的自己</div>
      </div>
      <ArrowRight size={16} className="shrink-0 text-post transition group-hover:translate-x-0.5" />
    </Link>
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

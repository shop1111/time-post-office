import { userPage } from "@/lib/auth";
import { XiaojuImage } from "@/components/XiaojuImage";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { db } from "@/lib/db";
import { getProfile } from "@/lib/memory/profile";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { MEMORY_CATEGORIES, categoryItems } from "@/lib/memory/map";
import { MemoryArt, categoryIcons } from "@/components/memory/MemoryArt";
import { CategoryLink } from "@/components/memory/CategoryLink";
import { RefreshProfile } from "@/components/memory/RefreshProfile";

async function MemoryPage() {
  const [profile, memories] = await Promise.all([
    getProfile(),
    db.memory.findMany({
      where: ACTIVE_MEMORY,
      orderBy: { occurredAt: "desc" },
      include: { entities: { include: { entity: true } } },
    }),
  ]);


  const style = profile.styleData;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-hand text-3xl">记忆</h1>
        <Link href="/memory/manage" className="btn btn-ghost text-sm">
          记忆管理 <ArrowRight size={14} />
        </Link>
      </header>

      <section className="grid gap-4 md:grid-cols-5">
        <div className="card p-5 md:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="font-hand text-xl">小局眼中的你</h2>
            <RefreshProfile stale={profile.isStale} />
          </div>
          {profile.isStale && <span className="chip mt-3 !bg-gold/20">画像待更新</span>}
          <div className="mt-3 flex items-center gap-3">
            <p className="min-w-0 flex-1 text-[15px] leading-7">{profile.isStale ? "请根据当前有效记忆更新画像，旧结论已暂停使用。" : profile.summary || "还在慢慢认识你。"}</p>
            <XiaojuImage scene="memory" className="h-20 w-16 sm:h-24 sm:w-24" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {profile.traitsList.map((t) => (
              <span key={t} className="chip !bg-stamp-soft !text-stamp">
                {t}
              </span>
            ))}
          </div>
        </div>
        <div className="card p-5 md:col-span-2">
          <h2 className="font-hand text-xl">你的文风指纹</h2>
          <p className="mt-1 text-xs text-ink-3">从你写下的文字中本地统计，用于让平行时空的你写信时像你本人。</p>
          {style ? (
            <dl className="mt-3 space-y-2 text-sm">
              <Row k="平均句长" v={`${style.avgSentenceLen} 字`} />
              <Row k="口头禅" v={style.catchphrases.join("、") || "—"} />
              <Row k="句尾语气词" v={style.particles.join(" ") || "—"} />
              <Row k="感叹 / 省略" v={`${Math.round(style.exclaimRate * 100)}% / ${Math.round(style.ellipsisRate * 100)}%`} />
              <Row k="高频词" v={style.topWords.slice(0, 6).join(" ") || "—"} />
              {style.samples[0] && <p className="pt-1 font-hand text-[15px] text-ink-2">「{style.samples[0]}」</p>}
            </dl>
          ) : (
            <p className="mt-3 text-sm text-ink-3">{profile.isStale ? "记忆有了变化，更新画像后会同步恢复文风指纹。" : "多写几篇就能看到了。"}</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="font-hand text-xl">记忆地图</h2>
        <p className="mb-4 mt-1 text-sm text-ink-3">小局按类别整理了你生活里的记忆</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MEMORY_CATEGORIES.map((category) => {
            const items = categoryItems(category.id, memories);
            const Icon = categoryIcons[category.id];
            const examples = category.type ? items.slice(0, 3).map((item) => item.title) : [...new Set(items.flatMap((item) => item.themes))].slice(0, 3);
            const unit = { people: "人", places: "处", events: "条", preferences: "项", goals: "条", facts: "条" }[category.id];
            return <CategoryLink key={category.id} category={category.id} className="card group relative flex min-h-48 flex-col overflow-hidden p-5 transition-colors hover:border-gold/50 focus-visible:outline-2 focus-visible:outline-stamp focus-visible:outline-offset-4">
              <div className="relative z-10 flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 font-hand text-xl"><Icon size={22} strokeWidth={1.6} className="shrink-0 text-ink-3" />{category.title}</h3><span className="chip shrink-0">{items.length} {unit}</span></div>
              <p className="relative z-10 mt-4 pr-12 text-sm leading-6 text-ink-2">{category.description}</p>
              <MemoryArt category={category.id} className="pointer-events-none absolute bottom-10 right-7 w-28 opacity-80" />
              <div className="relative z-10 mt-auto flex items-end justify-between gap-2 pt-7"><div className="flex max-w-[75%] flex-wrap gap-1.5">{examples.length ? examples.map((example) => <span key={example} className="chip max-w-full truncate">{example}</span>) : <span className="chip">慢慢收集生活里的记忆</span>}</div><ArrowRight size={17} className="shrink-0 text-ink-3 group-hover:text-ink" /></div>
            </CategoryLink>;
          })}
        </div>
      </section>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-ink-3">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

export default userPage(MemoryPage);

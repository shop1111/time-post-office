import { db } from "@/lib/db";
import { getProfile } from "@/lib/memory/profile";
import { MemoryGraph } from "@/components/memory/MemoryGraph";
import { buildMemoryGraph } from "@/lib/memory/graph";
import { MemoryList } from "@/components/memory/MemoryList";
import { RefreshProfile } from "@/components/memory/RefreshProfile";

export default async function MemoryPage() {
  const [profile, memories] = await Promise.all([
    getProfile(),
    db.memory.findMany({ orderBy: { occurredAt: "desc" }, include: { entities: { include: { entity: true } } } }),
  ]);

  const graph = buildMemoryGraph(profile.name, memories);
  const activeCount = memories.filter((m) => m.status === "active").length;
  const style = profile.styleData;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-hand text-3xl">记忆</h1>
        <p className="mt-1 text-sm text-ink-2">记错了可以更正，不想用于长期记忆可以撤回。记忆由你掌控。</p>
        <p className="mt-2 text-xs leading-6 text-ink-3">撤回会保留操作记录，原始胶囊和历史信件仍在；不等同于删除全部相关内容。</p>
      </header>

      <section className="grid gap-4 md:grid-cols-5">
        <div className="card p-5 md:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="font-hand text-xl">AI 眼中的你</h2>
            <RefreshProfile stale={profile.isStale} />
          </div>
          {profile.isStale && <span className="chip mt-3 !bg-gold/20">画像待更新</span>}
          <p className="mt-3 text-[15px] leading-7">{profile.isStale ? "请根据当前有效记忆更新画像，旧结论已暂停使用。" : profile.summary || "还在慢慢认识你。"}</p>
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
            <p className="mt-3 text-sm text-ink-3">多写几篇就能看到了。</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-hand text-xl">关系图谱</h2>
        <MemoryGraph data={graph} />
      </section>

      <section>
        <h2 className="mb-3 font-hand text-xl">记忆管理 · {activeCount} 条有效记忆</h2>
        <MemoryList
          items={memories.map((m) => ({
            id: m.id,
            kind: m.kind,
            content: m.content,
            importance: m.importance,
            occurredAt: m.occurredAt.toISOString(),
            dueAt: m.dueAt?.toISOString() ?? null,
            resolved: m.resolved,
            entryId: m.entryId,
            recallCount: m.recallCount,
            userEdited: m.userEdited,
            status: m.status,
            revision: m.revision,
            retractedAt: m.retractedAt?.toISOString() ?? null,
            entities: m.entities.map((e) => ({ name: e.entity.name, type: e.entity.type as "person" | "place" | "theme" })),
          }))}
        />
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

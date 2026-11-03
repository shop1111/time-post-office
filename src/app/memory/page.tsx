import { db } from "@/lib/db";
import { getProfile } from "@/lib/memory/profile";
import { MemoryGraph, type GraphData } from "@/components/memory/MemoryGraph";
import { MemoryList } from "@/components/memory/MemoryList";
import { RefreshProfile } from "@/components/memory/RefreshProfile";

export default async function MemoryPage() {
  const [profile, memories, entities] = await Promise.all([
    getProfile(),
    db.memory.findMany({ orderBy: { occurredAt: "desc" }, include: { entities: { include: { entity: true } } } }),
    db.entity.findMany({ include: { _count: { select: { memories: true } } } }),
  ]);

  // 实体图谱：我 → 实体；同一条记忆里共同出现的实体互相连线
  const co = new Map<string, number>();
  for (const m of memories) {
    const ids = m.entities.map((e) => e.entityId).sort();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) co.set(`${ids[i]}|${ids[j]}`, (co.get(`${ids[i]}|${ids[j]}`) ?? 0) + 1);
  }
  const graph: GraphData = {
    nodes: [{ id: "me", name: profile.name, type: "me", val: 10 }, ...entities.filter((e) => e._count.memories > 0).map((e) => ({ id: e.id, name: e.name, type: e.type, val: 2 + e._count.memories * 1.5 }))],
    links: [
      ...entities.filter((e) => e._count.memories > 0).map((e) => ({ source: "me", target: e.id, value: e._count.memories })),
      ...[...co.entries()].map(([k, v]) => {
        const [a, b] = k.split("|");
        return { source: a, target: b, value: v };
      }),
    ],
  };
  const style = profile.styleData;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-hand text-3xl">记忆宫殿</h1>
        <p className="mt-1 text-sm text-ink-2">邮差记住的关于你的一切都在这里。记错了可以改，不想被记住可以删——记忆属于你。</p>
      </header>

      <section className="grid gap-4 md:grid-cols-5">
        <div className="card p-5 md:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="font-hand text-xl">AI 眼中的你</h2>
            <RefreshProfile />
          </div>
          <p className="mt-3 text-[15px] leading-7">{profile.summary || "还在慢慢认识你。"}</p>
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
          <p className="mt-1 text-xs text-ink-3">从你写下的文字中本地统计，用于让「过去 / 未来的你」写信时像你本人。</p>
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
        <h2 className="mb-3 font-hand text-xl">全部记忆 · {memories.length}</h2>
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
            entities: m.entities.map((e) => e.entity.name),
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

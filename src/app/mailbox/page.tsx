import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { Envelope } from "@/components/Envelope";
import { CapsuleComposer } from "@/components/CapsuleComposer";
import { ForceLetter } from "@/components/ForceLetter";
import { fmtCN, daysBetween } from "@/lib/utils";

export default async function Mailbox() {
  const t = await now();
  const [inbox, transit] = await Promise.all([
    db.letter.findMany({ where: { deliveredAt: { not: null } }, orderBy: { deliveredAt: "desc" } }),
    db.letter.findMany({ where: { deliveredAt: null }, orderBy: { scheduledAt: "asc" } }),
  ]);
  const ser = (l: (typeof inbox)[number]) => ({
    ...l,
    deliveredAt: l.deliveredAt?.toISOString() ?? null,
    scheduledAt: l.scheduledAt.toISOString(),
    readAt: l.readAt?.toISOString() ?? null,
    writtenAt: l.writtenAt.toISOString(),
  });
  const unread = inbox.filter((l) => !l.readAt).length;

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-hand text-3xl">信箱</h1>
          <p className="mt-1 text-sm text-ink-2">
            共 {inbox.length} 封来信{unread ? `，${unread} 封未拆` : ""}。邮差会在合适的时候，替过去或未来的你写信。
          </p>
        </div>
        <ForceLetter />
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        {inbox.map((l, i) => (
          <Envelope key={l.id} l={ser(l)} index={i} />
        ))}
        {inbox.length === 0 && <p className="text-sm text-ink-3">还没有来信。多记录几天，或者用右上角的时光机快进看看。</p>}
      </section>

      {transit.length > 0 && (
        <section>
          <h2 className="mb-3 font-hand text-xl">正在路上的信</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {transit.map((l) => {
              const total = Math.max(1, daysBetween(l.writtenAt, l.scheduledAt));
              const left = Math.max(0, daysBetween(t, l.scheduledAt));
              return (
                <div key={l.id} className="card relative overflow-hidden p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <Lock size={14} className="text-gold" />
                    <span className="font-hand text-lg">{l.subject}</span>
                  </div>
                  <div className="mt-1 text-xs text-ink-3">
                    {fmtCN(l.writtenAt)} 寄出 · 将于 {fmtCN(l.scheduledAt)} 送达 · 还有 {left} 天
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper-2">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(100, ((total - left) / total) * 100)}%` }} />
                  </div>
                  <div className="pointer-events-none absolute -right-2 -top-2 text-5xl opacity-10">✈️</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 font-hand text-xl">写给未来的自己</h2>
        <CapsuleComposer today={t.toISOString()} />
      </section>
    </div>
  );
}

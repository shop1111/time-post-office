import Link from "next/link";
import { Lock } from "lucide-react";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { Envelope } from "@/components/Envelope";
import { ForceLetter } from "@/components/ForceLetter";
import { cn, fmtCN, daysBetween } from "@/lib/utils";

export default async function Mailbox({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const { category } = await searchParams;
  const t = await now();
  const [inbox, transit] = await Promise.all([
    db.letter.findMany({ where: { deliveredAt: { not: null } }, orderBy: { deliveredAt: "desc" } }),
    db.letter.findMany({ where: { deliveredAt: null }, orderBy: { scheduledAt: "asc" } }),
  ]);
  const ser = (l: (typeof inbox)[number]) => ({
    id: l.id,
    sender: l.sender,
    subject: l.subject,
    deliveredAt: l.deliveredAt?.toISOString() ?? null,
    scheduledAt: l.scheduledAt.toISOString(),
    readAt: l.readAt?.toISOString() ?? null,
    writtenAt: l.writtenAt.toISOString(),
  });
  const unread = inbox.filter((l) => !l.readAt);
  const read = inbox.filter((l) => l.readAt);
  const categories = {
    unread: { label: "未拆", letters: unread, empty: "没有待拆的来信。" },
    read: { label: "已拆", letters: read, empty: "还没有拆过的信。" },
    transit: { label: "在途", letters: transit, empty: "还没有在路上的信。" },
  };
  const defaultCategory = unread.length > 0 ? "unread" : "read";
  const activeCategory = category === "unread" || category === "read" || category === "transit" ? category : defaultCategory;
  const { letters, empty } = categories[activeCategory];

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-hand text-3xl">信箱</h1>
          <p className="mt-1 text-sm text-ink-2">
            共 {inbox.length} 封来信{unread.length > 0 ? `，${unread.length} 封未拆` : ""}。邮差会在合适的时候，替过去或未来的你写信。
          </p>
        </div>
        <ForceLetter />
      </header>

      <section className="space-y-4" aria-label="信件分类">
        <nav className="flex flex-wrap gap-2" aria-label="按状态查看信件">
          {Object.entries(categories).map(([id, { label, letters }]) => (
            <Link
              key={id}
              href={`/mailbox?category=${id}`}
              scroll={false}
              aria-current={id === activeCategory ? "page" : undefined}
              className={cn(
                "chip !px-3 !py-2 transition-colors hover:!border-stamp",
                id === activeCategory && "!border-stamp !bg-stamp !text-white",
              )}
            >
              {label} <span className="tabular-nums opacity-75">{letters.length}</span>
            </Link>
          ))}
        </nav>

        {letters.length === 0 ? (
          <p className="card p-4 text-sm text-ink-3">{empty}</p>
        ) : activeCategory === "transit" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {letters.map((l) => {
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
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {letters.map((l) => (
              <Envelope key={l.id} l={ser(l)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

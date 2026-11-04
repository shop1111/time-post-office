import Link from "next/link";
import { Lock, PenLine, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { now } from "@/lib/clock";
import { ensureSystemCorrespondents } from "@/lib/correspondents";
import { INBOX_WHERE, toEnvelope } from "@/lib/letter-dto";
import { Envelope } from "@/components/Envelope";
import { CorrespondentCard } from "@/components/mail/CorrespondentCard";
import { CorrespondentForm } from "@/components/mail/CorrespondentForm";
import { cn, fmtCN, daysBetween } from "@/lib/utils";

const TABS = [
  { k: "inbox", label: "收件箱" },
  { k: "sent", label: "寄出的信" },
  { k: "people", label: "收件人" },
] as const;

export default async function Mail({ searchParams }: { searchParams: Promise<{ tab?: string; category?: string }> }) {
  const { tab: raw, category } = await searchParams;
  const tab = TABS.some((t) => t.k === raw) ? raw! : "inbox";
  const t = await now();
  await ensureSystemCorrespondents();
  const [inbox, sent, people] = await Promise.all([
    db.letter.findMany({ where: INBOX_WHERE, orderBy: { deliveredAt: "desc" }, include: { correspondent: true } }),
    db.letter.findMany({ where: { sender: "user" }, orderBy: { writtenAt: "desc" }, include: { correspondent: true } }),
    db.correspondent.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { letters: true } } } }),
  ]);
  const unread = inbox.filter((l) => !l.readAt);
  const read = inbox.filter((l) => l.readAt);
  // 收件箱按状态分：未拆 / 已拆（在路上的信在「寄出的信」里看）
  const categories = {
    unread: { label: "未拆", letters: unread, empty: "没有待拆的来信。" },
    read: { label: "已拆", letters: read, empty: "还没有拆过的信。" },
  };
  const activeCategory = category === "unread" || category === "read" ? category : unread.length > 0 ? "unread" : "read";
  const { letters: shown, empty } = categories[activeCategory];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-hand text-3xl">邮件</h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-ink-2">
            写信给某个人、平行时空的自己或小局，TA 会在一天之内回信（由 agent 以 TA 的身份代笔）。写给未来自己的信，会在你选的那天送回到你手里。
          </p>
        </div>
        <Link href="/mail/write" className="btn btn-primary">
          <PenLine size={15} /> 写一封信
        </Link>
      </header>

      <nav className="inline-flex rounded-full border border-line bg-card p-1">
        {TABS.map((x) => (
          <Link key={x.k} href={`/mail?tab=${x.k}`} className={cn("rounded-full px-4 py-1.5 text-sm transition", tab === x.k ? "bg-stamp text-white" : "text-ink-2")}>
            {x.label}
            {x.k === "inbox" && unread.length > 0 && <span className="ml-1 opacity-80">{unread.length}</span>}
          </Link>
        ))}
      </nav>

      {tab === "inbox" && (
        <section className="space-y-4" aria-label="来信分类">
          {inbox.length > 0 && (
            <nav className="flex flex-wrap gap-2" aria-label="按状态查看来信">
              {Object.entries(categories).map(([id, { label, letters }]) => (
                <Link
                  key={id}
                  href={`/mail?tab=inbox&category=${id}`}
                  scroll={false}
                  aria-current={id === activeCategory ? "page" : undefined}
                  className={cn("chip !px-3 !py-2 transition-colors hover:!border-stamp", id === activeCategory && "!border-stamp !bg-stamp !text-white")}
                >
                  {label} <span className="tabular-nums opacity-75">{letters.length}</span>
                </Link>
              ))}
            </nav>
          )}
          {inbox.length === 0 ? (
            <p className="text-sm text-ink-3">还没有来信。放几颗胶囊、写几封信，小局和收件人们会给你回信的。</p>
          ) : shown.length === 0 ? (
            <p className="card p-4 text-sm text-ink-3">{empty}</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {shown.map((l, i) => (
                <Envelope key={l.id} l={toEnvelope(l)} index={i} />
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "sent" && (
        <section className="space-y-3">
          {sent.length === 0 && <p className="text-sm text-ink-3">你还没有寄出过信。</p>}
          {sent.map((l) => {
            const future = l.correspondent?.kind === "future_self";
            const replied = !!l.replyLetterId && !l.replyLetterId.startsWith("pending:");
            const left = Math.max(0, daysBetween(t, l.scheduledAt));
            const total = Math.max(1, daysBetween(l.writtenAt, l.scheduledAt));
            return (
              <Link key={l.id} href={`/mail/${l.id}`} className="card relative block overflow-hidden p-4 transition hover:-translate-y-0.5">
                <div className="flex items-center gap-2 text-xs text-ink-3">
                  {future && !l.deliveredAt && <Lock size={12} className="text-gold" />}
                  寄给{future ? "未来的自己" : l.correspondent?.name ?? "小局"} · {fmtCN(l.writtenAt)}
                  <span className="ml-auto">
                    {future
                      ? l.deliveredAt
                        ? "已送达"
                        : `${left} 天后送达`
                      : l.replyDueAt
                        ? replied
                          ? "已回信"
                          : "回信在路上"
                        : "已寄出"}
                  </span>
                </div>
                <div className="mt-1 font-hand text-lg">{l.subject}</div>
                {future && !l.deliveredAt ? (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper-2">
                    <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(100, ((total - left) / total) * 100)}%` }} />
                  </div>
                ) : (
                  <p className="mt-1 line-clamp-2 text-sm text-ink-2">{l.body}</p>
                )}
              </Link>
            );
          })}
        </section>
      )}

      {tab === "people" && (
        <section className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2">
            {people.map((p) => (
              <CorrespondentCard key={p.id} c={{ id: p.id, kind: p.kind, name: p.name, relation: p.relation, moment: p.moment, momentAt: p.momentAt?.toISOString() ?? null, letters: p._count.letters }} />
            ))}
          </div>
          <div>
            <h2 className="mb-1 flex items-center gap-1 font-hand text-xl">
              <Plus size={18} /> 新收件人
            </h2>
            <p className="mb-3 text-sm text-ink-2">可以是某个瞬间帮过你的人、想念的人，也可以是平行时空里做了另一个选择的自己。</p>
            <CorrespondentForm today={t.toISOString()} />
          </div>
        </section>
      )}
    </div>
  );
}

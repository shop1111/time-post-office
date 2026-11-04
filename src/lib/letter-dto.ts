import type { Correspondent, Letter } from "@prisma/client";
import type { EnvelopeData } from "@/components/Envelope";

type WithParty = Letter & { correspondent: Pick<Correspondent, "kind" | "name"> | null };

/** 服务端组件 → 信封组件：日期转成 ISO，带上往来另一方 */
export function toEnvelope(l: WithParty): EnvelopeData {
  return {
    id: l.id,
    sender: l.sender,
    subject: l.subject,
    deliveredAt: l.deliveredAt?.toISOString() ?? null,
    scheduledAt: l.scheduledAt.toISOString(),
    readAt: l.readAt?.toISOString() ?? null,
    writtenAt: l.writtenAt.toISOString(),
    kind: l.correspondent?.kind ?? null,
    name: l.correspondent?.name ?? null,
  };
}

/**
 * 收件箱：别人写给你的信 + 已经送达的、写给未来自己的信。
 * 你寄给别人的信不在收件箱里。
 */
export const INBOX_WHERE = {
  deliveredAt: { not: null },
  OR: [{ sender: { not: "user" } }, { correspondent: { kind: "future_self" } }],
};

import { db } from "@/lib/db";
import { computeStyle, describeStyle } from "@/lib/memory/style";

/** 和项目的日期展示一致，按服务器本地日历日取次日零点，使用严格小于比较。 */
export function writtenDayEnd(writtenAt: Date): Date {
  const end = new Date(writtenAt);
  end.setHours(24, 0, 0, 0);
  return end;
}

export async function historicalStyle(before: Date) {
  const entries = await db.entry.findMany({
    where: { occurredAt: { lt: before } }, orderBy: { occurredAt: "desc" }, take: 80,
    include: { messages: { where: { role: "user", createdAt: { lt: before } } } },
  });
  const style = computeStyle(entries.flatMap((entry) => [entry.text, entry.transcript ?? "", ...entry.messages.map((message) => message.content)]).filter(Boolean));
  return { style, desc: describeStyle(style) };
}

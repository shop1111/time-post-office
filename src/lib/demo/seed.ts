import { db } from "@/lib/db";
import { embed } from "@/lib/ai/provider";
import { toBytes } from "@/lib/memory/embed-lite";
import { computeStyle } from "@/lib/memory/style";
import { resetClock } from "@/lib/clock";
import { DERIVED_REVISION_KEY, PROFILE_REVISION_KEY } from "@/lib/memory/consistency";
import { DEMO_ENTRIES, DEMO_LETTERS, EXAM_IN_DAYS } from "./data";

const DAY = 86_400_000;

export async function clearAll() {
  await db.$transaction([
    db.job.deleteMany(),
    db.memoryEntity.deleteMany(),
    db.memory.deleteMany(),
    db.entity.deleteMany(),
    db.storyCard.deleteMany(),
    db.entryMessage.deleteMany(),
    db.entry.deleteMany(),
    db.letter.deleteMany(),
    db.monthlyRecap.deleteMany(),
    db.profile.deleteMany(),
    // 数据清空后派生版本从 0 重新开始
    db.setting.deleteMany({ where: { key: { in: [DERIVED_REVISION_KEY, PROFILE_REVISION_KEY] } } }),
  ]);
  await resetClock();
}

/** 载入示例人生「林小满」。时间相对真实的现在计算 */
export async function loadDemo() {
  await clearAll();
  const now = new Date();
  const at = (daysAgo: number, hour = 12) => {
    const d = new Date(now.getTime() - daysAgo * DAY);
    d.setHours(hour, (daysAgo * 7) % 60, 0, 0);
    return d;
  };
  const exam = new Date(now.getTime() + EXAM_IN_DAYS * DAY);
  const examDate = `${exam.getMonth() + 1}月${exam.getDate()}日`;
  const fill = (s: string) => s.replaceAll("{examDate}", examDate);

  const allMems = DEMO_ENTRIES.flatMap((e) => e.memories.map((m) => fill(m.content)));
  const vecs = await embed(allMems);
  let vi = 0;

  const entityIds = new Map<string, string>();
  const memIdsByEntry = new Map<string, string[]>();
  const entryIds = new Map<string, string>();

  for (const e of DEMO_ENTRIES) {
    const occurredAt = at(e.daysAgo, e.hour);
    const text = fill(e.text);
    const entry = await db.entry.create({
      data: {
        type: e.type,
        text,
        transcript: e.type === "voice" ? text : null,
        photoPath: e.scene ? `/api/scene/${e.scene}` : null,
        visionCaption: e.caption ?? null,
        place: e.place ?? null,
        occurredAt,
        mood: e.mood,
        emotions: JSON.stringify(e.emotions),
        title: e.title,
        summary: e.summary,
        interviewDone: true,
        createdAt: occurredAt,
        messages: e.chat ? { create: e.chat.map(([role, content], i) => ({ role, content, createdAt: new Date(occurredAt.getTime() + (i + 1) * 60_000) })) } : undefined,
        cards: e.card ? { create: { ...e.card, template: e.card.template ?? "paper", createdAt: occurredAt } } : undefined,
      },
    });
    entryIds.set(e.key, entry.id);
    const ids: string[] = [];
    for (const m of e.memories) {
      const mem = await db.memory.create({
        data: {
          entryId: entry.id,
          kind: m.kind,
          content: fill(m.content),
          importance: m.importance,
          occurredAt,
          dueAt: m.dueInDays !== undefined ? new Date(now.getTime() + m.dueInDays * DAY) : null,
          resolved: m.resolved ?? false,
          embedding: toBytes(vecs[vi++]),
          createdAt: occurredAt,
        },
      });
      ids.push(mem.id);
      for (const [name, type] of m.entities) {
        const k = `${type}:${name}`;
        if (!entityIds.has(k)) entityIds.set(k, (await db.entity.create({ data: { name, type, createdAt: occurredAt } })).id);
        await db.memoryEntity.create({ data: { memoryId: mem.id, entityId: entityIds.get(k)! } });
      }
    }
    memIdsByEntry.set(e.key, ids);
  }

  for (const l of DEMO_LETTERS) {
    const delivered = at(l.deliverDaysAgo, 9);
    const key = l.key?.startsWith("anniv:")
      ? l.key.replace(/^anniv:([^:]+):/, (_, k: string) => `anniv:${entryIds.get(k)}:`)
      : l.key;
    await db.letter.create({
      data: {
        sender: l.sender,
        subject: l.subject,
        body: l.body,
        triggerType: l.triggerType,
        triggerKey: key,
        reason: l.reason,
        citedMemoryIds: JSON.stringify((l.citeKeys ?? []).flatMap((k) => memIdsByEntry.get(k) ?? [])),
        writtenAt: at(l.writtenDaysAgo, 21),
        scheduledAt: delivered,
        deliveredAt: l.deliverDaysAgo >= 0 ? delivered : null,
        readAt: l.read ? delivered : null,
        reply: l.reply ?? null,
        repliedAt: l.reply ? new Date(delivered.getTime() + 3 * 3_600_000) : null,
        createdAt: at(l.writtenDaysAgo, 21),
      },
    });
  }

  // 画像：文风指纹本地计算；摘要用预写的，保证演示质量且不依赖网络
  const texts = DEMO_ENTRIES.flatMap((e) => [fill(e.text), ...(e.chat ?? []).filter(([r]) => r === "user").map(([, c]) => c)]);
  const style = computeStyle(texts);
  // 用 upsert：载入期间页面请求可能已经用 getProfile() 建了空画像
  const profile = {
    name: "小满",
    summary:
      "你是一个从老家来到杭州、一个人认真生活的设计师。你会为一个像素失眠，也会为一场夕阳停下脚步。妈妈、小鹿和阿哲是你最常提起的人，年糕是你的室友。你在学胶片摄影，心里藏着一个「办一次自己的小摄影展」的愿望。最近工作压力有点大，但你一直在慢慢来。",
    traits: JSON.stringify(["认真到失眠", "胶片摄影新手", "恋家", "爱看日出日落", "猫奴", "慢慢来"]),
    style: JSON.stringify(style),
  };
  await db.profile.upsert({ where: { id: "me" }, create: { id: "me", ...profile }, update: profile });
  // 预写画像对应当前（初始）版本
  await db.setting.upsert({ where: { key: PROFILE_REVISION_KEY }, create: { key: PROFILE_REVISION_KEY, value: "0" }, update: { value: "0" } });

  return { entries: DEMO_ENTRIES.length, letters: DEMO_LETTERS.length };
}

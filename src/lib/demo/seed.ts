import { db } from "@/lib/db";
import { embed } from "@/lib/ai/provider";
import { toBytes } from "@/lib/memory/embed-lite";
import { computeStyle } from "@/lib/memory/style";
import { DERIVED_REVISION_KEY, PROFILE_REVISION_KEY } from "@/lib/memory/consistency";
import { ensureSystemCorrespondents } from "@/lib/correspondents";
import { DEMO_CORRESPONDENTS, DEMO_ENTRIES, DEMO_LETTERS, EXAM_IN_DAYS } from "./data";

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
    db.correspondent.deleteMany(),
    db.monthlyRecap.deleteMany(),
    db.profile.deleteMany(),
    // 数据清空后派生版本从 0 重新开始
    db.setting.deleteMany({ where: { key: { in: [DERIVED_REVISION_KEY, PROFILE_REVISION_KEY, "clockOffsetMs"] } } }),
  ]);
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

  // 收件人：小局、未来的我，以及示例里的朋友
  const { curator, futureSelf } = await ensureSystemCorrespondents();
  const people = new Map<string, string>([["curator", curator.id], ["future_self", futureSelf.id]]);
  for (const c of DEMO_CORRESPONDENTS) {
    const row = await db.correspondent.create({
      data: { kind: "person", name: c.name, relation: c.relation, moment: c.moment, momentAt: at(c.momentDaysAgo, 16), voice: c.voice, createdAt: at(178, 22) },
    });
    people.set(c.key, row.id);
  }

  // 今天的时间不能晚于现在
  const past = (daysAgo: number, hour: number) => {
    const d = at(daysAgo, hour);
    return d.getTime() > now.getTime() ? new Date(now.getTime() - 60_000) : d;
  };
  const letterIds = new Map<string, string>();
  for (const l of DEMO_LETTERS) {
    const delivered = l.deliverDaysAgo >= 0 ? past(l.deliverDaysAgo, 9) : at(l.deliverDaysAgo, 9);
    const writtenAt = past(l.writtenDaysAgo, 21);
    const key = l.key?.startsWith("anniv:")
      ? l.key.replace(/^anniv:([^:]+):/, (_, k: string) => `anniv:${entryIds.get(k)}:`)
      : l.key;
    const citedIds = (l.citeKeys ?? []).flatMap((k) => memIdsByEntry.get(k) ?? []);
    const original = l.inReplyTo ? letterIds.get(l.inReplyTo) : undefined;
    const knowledge =
      l.sender === "persona"
        ? { known: (await db.memory.findMany({ where: { id: { in: citedIds } } })).map((m) => ({ id: m.id, content: m.content, why: "TA也在场" })), unknown: [] }
        : {};
    const letter = await db.letter.create({
      data: {
        sender: l.sender,
        correspondentId: people.get(l.to) ?? curator.id,
        inReplyToId: original ?? null,
        subject: l.subject,
        body: l.body,
        triggerType: l.triggerType,
        triggerKey: key,
        reason: l.reason,
        citedMemoryIds: JSON.stringify(citedIds),
        knowledge: JSON.stringify(knowledge),
        writtenAt,
        scheduledAt: delivered,
        deliveredAt: l.deliverDaysAgo >= 0 ? delivered : null,
        readAt: l.read ? delivered : null,
        replyDueAt: l.replyInHours !== undefined ? new Date(now.getTime() + l.replyInHours * 3_600_000) : null,
        createdAt: writtenAt,
      },
    });
    letterIds.set(l.subject, letter.id);
    if (original) await db.letter.update({ where: { id: original }, data: { replyLetterId: letter.id, replyDueAt: delivered } });
    // 小满对小局来信的回信：一封寄给小局的信（不再等回信）
    if (l.reply) {
      const at3h = new Date(delivered.getTime() + 3 * 3_600_000);
      await db.letter.create({
        data: {
          sender: "user", correspondentId: curator.id, inReplyToId: letter.id, subject: `回复：${l.subject}`, body: l.reply,
          triggerType: "letter", reason: "你写给小局的回信", writtenAt: at3h, scheduledAt: at3h, deliveredAt: at3h, readAt: at3h, createdAt: at3h,
        },
      });
    }
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

  return { entries: DEMO_ENTRIES.length, letters: DEMO_LETTERS.length, correspondents: DEMO_CORRESPONDENTS.length };
}

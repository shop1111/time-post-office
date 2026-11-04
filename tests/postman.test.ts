import { describe, expect, it } from "vitest";
import { collectCandidates, anniversaryTriggers, openLoopTriggers, lowMoodTriggers, milestoneTriggers, greetingTrigger, type Snapshot } from "@/lib/postman/triggers";

const DAY = 86_400_000;
const NOW = new Date("2026-11-03T12:00:00");
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return { now: NOW, entries: [], memories: [], sentKeys: new Set(), entityFreq: [], ...over };
}

describe("小局来信的触发器", () => {
  it("旅行照片满 90 天 → 小局来信回顾，且只寄一次", () => {
    const s = snap({
      entries: [{ id: "trip", occurredAt: ago(92), mood: 0.9, title: "洱海日出", type: "photo" }],
      memories: [{ id: "m1", entryId: "trip", kind: "event", content: "洱海日出", importance: 9, occurredAt: ago(92), dueAt: null, resolved: false, entities: ["洱海"] }],
    });
    const c = anniversaryTriggers(s);
    expect(c).toHaveLength(1);
    expect(c[0].sender).toBe("curator");
    // 不再冒充过去的自己：落款就是今天
    expect(c[0].writtenAt.getTime()).toBe(NOW.getTime());
    s.sentKeys.add(c[0].key);
    expect(anniversaryTriggers(s)).toHaveLength(0);
  });

  it("不重要的文字记录不触发周年回顾", () => {
    const s = snap({
      entries: [{ id: "e", occurredAt: ago(31), mood: 0, title: "普通的一天", type: "text" }],
      memories: [{ id: "m", entryId: "e", kind: "event", content: "吃了饭", importance: 3, occurredAt: ago(31), dueAt: null, resolved: false, entities: [] }],
    });
    expect(anniversaryTriggers(s)).toHaveLength(0);
  });

  it("计划到期 → 追问结果；已解决的不再追问", () => {
    const plan = { id: "p", entryId: "e", kind: "plan", content: "11月1日考试", importance: 8, occurredAt: ago(30), dueAt: ago(2), resolved: false, entities: [] };
    const loop = openLoopTriggers(snap({ memories: [plan] }))[0];
    expect(loop.sender).toBe("curator");
    expect(loop.writtenAt.getTime()).toBe(NOW.getTime());
    expect(openLoopTriggers(snap({ memories: [{ ...plan, resolved: true }] }))).toHaveLength(0);
    expect(openLoopTriggers(snap({ memories: [{ ...plan, dueAt: new Date(NOW.getTime() + DAY) }] }))).toHaveLength(0);
  });

  it("一周情绪低落 → 小局来信安慰，并带上一段明亮的旧记忆", () => {
    const s = snap({
      entries: [
        { id: "a", occurredAt: ago(1), mood: -0.6, title: "", type: "text" },
        { id: "b", occurredAt: ago(4), mood: -0.7, title: "", type: "text" },
        { id: "old", occurredAt: ago(80), mood: 0.9, title: "", type: "photo" },
      ],
      memories: [
        { id: "ma", entryId: "a", kind: "event", content: "被批评了", importance: 7, occurredAt: ago(1), dueAt: null, resolved: false, entities: [] },
        { id: "mo", entryId: "old", kind: "event", content: "洱海日出", importance: 9, occurredAt: ago(80), dueAt: null, resolved: false, entities: [] },
      ],
    });
    const c = lowMoodTriggers(s);
    expect(c[0].sender).toBe("curator");
    expect(c[0].anchorMemoryIds).toEqual(["ma", "mo"]);
  });

  it("某人反复出现 → 里程碑", () => {
    const c = milestoneTriggers(snap({ entityFreq: [{ name: "小鹿", type: "person", count: 5 }] }));
    expect(c.some((x) => x.key === "person:小鹿")).toBe(true);
  });

  it("候选按优先级排序：情绪关怀优先", () => {
    const s = snap({
      entries: [
        { id: "a", occurredAt: ago(1), mood: -0.8, title: "", type: "text" },
        { id: "b", occurredAt: ago(2), mood: -0.8, title: "", type: "text" },
      ],
      entityFreq: [{ name: "妈妈", type: "person", count: 4 }],
    });
    expect(collectCandidates(s)[0].type).toBe("low_mood");
  });

  it("随手问候：距上一封满 3 天且随机命中时，挑一颗最近的胶囊或一封寄出的信", () => {
    const base = {
      entries: [{ id: "e", occurredAt: ago(2), mood: 0.2, title: "下班路上", type: "text" }],
      sentLetters: [{ id: "l", to: "小明", subject: "谢谢那把伞", body: "那天下雨你把伞给了我", writtenAt: ago(1) }],
      lastCuratorAt: ago(4),
    };
    const hit = greetingTrigger(snap({ ...base, rand: () => 0.1 }));
    expect(hit).toHaveLength(1);
    expect(hit[0].type).toBe("greeting");
    expect(hit[0].sender).toBe("curator");
    expect(greetingTrigger(snap({ ...base, rand: () => 0.9 }))).toHaveLength(0);
    // 小局刚写过信就不问候
    expect(greetingTrigger(snap({ ...base, lastCuratorAt: ago(1), rand: () => 0.1 }))).toHaveLength(0);
    // 已经问候过同一颗胶囊就不再问候
    expect(greetingTrigger(snap({ ...base, sentKeys: new Set([hit[0].key]), rand: () => 0.1 }))).toHaveLength(0);
  });

  it("随手问候优先级低于情绪关怀", () => {
    const s = snap({
      entries: [
        { id: "a", occurredAt: ago(1), mood: -0.8, title: "", type: "text" },
        { id: "b", occurredAt: ago(2), mood: -0.8, title: "", type: "text" },
      ],
      rand: () => 0.1,
    });
    const c = collectCandidates(s);
    expect(c[0].type).toBe("low_mood");
    expect(c.some((x) => x.type === "greeting")).toBe(true);
  });
});

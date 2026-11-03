import { describe, expect, it } from "vitest";
import { collectCandidates, anniversaryTriggers, openLoopTriggers, lowMoodTriggers, milestoneTriggers, type Snapshot } from "@/lib/postman/triggers";

const DAY = 86_400_000;
const NOW = new Date("2026-11-03T12:00:00");
const ago = (d: number) => new Date(NOW.getTime() - d * DAY);

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return { now: NOW, entries: [], memories: [], entityFreq: [], ...over };
}

describe("邮差触发器", () => {
  it("明亮旧记忆必须属于正向旧记录，不选重要但悲伤、无情绪或未来的记录", () => {
    const s = snap({
      entries: [
        { id: "a", occurredAt: ago(1), mood: -0.8, title: "", type: "text" },
        { id: "b", occurredAt: ago(2), mood: -0.8, title: "", type: "text" },
        { id: "sad", occurredAt: ago(90), mood: -0.9, title: "", type: "text" },
        { id: "unknown", occurredAt: ago(90), mood: null, title: "", type: "text" },
        { id: "bright", occurredAt: ago(90), mood: 0.25, title: "", type: "text" },
        { id: "future", occurredAt: ago(-1), mood: 0.9, title: "", type: "text" },
      ],
      memories: ["sad", "unknown", "bright", "future"].map((id) => ({ id, entryId: id, kind: "event", content: id, importance: id === "bright" ? 7 : 10, occurredAt: ago(90), dueAt: null, resolved: false, entities: [] })),
    });
    expect(lowMoodTriggers(s)[0].anchorMemoryIds).toEqual(["bright"]);
  });
  it("输出所有已达到的记录里程碑，由引擎统一去重，不因10条挡住30条", () => {
    const entries = Array.from({ length: 35 }, (_, i) => ({ id: String(i), occurredAt: ago(1), mood: 0, title: "", type: "text" }));
    expect(milestoneTriggers(snap({ entries })).map((c) => c.key)).toEqual(["count:10", "count:30"]);
  });
  it("旅行照片满 90 天 → 过去的你候选，去重由引擎负责", () => {
    const s = snap({
      entries: [{ id: "trip", occurredAt: ago(92), mood: 0.9, title: "洱海日出", type: "photo" }],
      memories: [{ id: "m1", entryId: "trip", kind: "event", content: "洱海日出", importance: 9, occurredAt: ago(92), dueAt: null, resolved: false, entities: ["洱海"] }],
    });
    const c = anniversaryTriggers(s);
    expect(c).toHaveLength(1);
    expect(c[0].sender).toBe("past_self");
    expect(c[0].writtenAt.getTime()).toBe(ago(92).getTime());
    expect(anniversaryTriggers(s)).toHaveLength(1);
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
    expect(openLoopTriggers(snap({ memories: [plan] }))[0].sender).toBe("past_self");
    expect(openLoopTriggers(snap({ memories: [{ ...plan, resolved: true }] }))).toHaveLength(0);
    expect(openLoopTriggers(snap({ memories: [{ ...plan, dueAt: new Date(NOW.getTime() + DAY) }] }))).toHaveLength(0);
  });

  it("一周情绪低落 → 未来的你来信，并带上一段明亮的旧记忆", () => {
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
    expect(c[0].sender).toBe("future_self");
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
});

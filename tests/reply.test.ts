import { describe, expect, it } from "vitest";
import { gateByRules, parallelQuery, pickReplyDelay, REPLY_MAX_HOURS, REPLY_MIN_HOURS } from "@/lib/postman/reply";
import { letterEcho } from "@/lib/ai/mock";

const HOUR = 3_600_000;

describe("代笔回信", () => {
  it("回信延迟在 2~24 小时之间；演示开关打开时立即送达", () => {
    expect(pickReplyDelay(() => 0)).toBe(REPLY_MIN_HOURS * HOUR);
    expect(pickReplyDelay(() => 0.999999)).toBeLessThanOrEqual(REPLY_MAX_HOURS * HOUR);
    for (let i = 0; i < 50; i++) {
      const d = pickReplyDelay();
      expect(d).toBeGreaterThanOrEqual(REPLY_MIN_HOURS * HOUR);
      expect(d).toBeLessThanOrEqual(REPLY_MAX_HOURS * HOUR);
    }
    expect(pickReplyDelay(() => 0.5, true)).toBe(0);
  });

  it("知识边界：小明在场的经历、信里讲过的事算他知道，其余算不知道", () => {
    const cands = [
      { id: "rain", kind: "event", content: "下大雨小明把伞给了她，自己淋雨跑回去", entities: ["小明"] },
      { id: "mom", kind: "event", content: "妈妈来杭州看她，一起逛西湖", entities: ["妈妈", "西湖"] },
      { id: "job", kind: "event", content: "最近换了一份新工作，去了一家设计公司", entities: ["工作"] },
      { id: "plan", kind: "plan", content: "想和小明一起吃顿饭", entities: ["小明"] },
    ];
    const thread = "小满 → 小明《好久不见》：我最近换了一份新工作，挺累的。";
    const { known, unknown } = gateByRules("小明", cands, thread);
    expect(known.map((k) => k.id).sort()).toEqual(["job", "rain"]);
    expect(unknown.map((k) => k.id).sort()).toEqual(["mom", "plan"]);
  });

  it("知识边界：只和信里撞上一个词不算告诉过他", () => {
    const cands = [{ id: "praise", kind: "event", content: "第一次独立负责的项目上线，被老板在周会上点名表扬", entities: ["工作"] }];
    const { known } = gateByRules("小鹿", cands, "小满 → 小鹿：这两天项目上线前一直失眠。");
    expect(known).toHaveLength(0);
  });

  it("回信引用来信时跳过称呼和落款", () => {
    expect(letterEcho("小鹿：\n\n这两天有点撑不住。项目上线前一直失眠。\n\n—— 满满")).toBe("这两天有点撑不住");
  });

  it("平行时空的自己只检索分岔点之前的记忆", () => {
    const at = new Date("2023-06-01T12:00:00");
    const q = parallelQuery({ moment: "如果当时没有来杭州", momentAt: at }, "你现在在干什么？");
    expect(q.before).toBe(at);
    expect(q.query).toContain("没有来杭州");
    expect(() => parallelQuery({ moment: "x", momentAt: null }, "")).toThrow();
  });
});

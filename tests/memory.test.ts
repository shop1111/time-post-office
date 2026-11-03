import { describe, expect, it } from "vitest";
import { embedLite, cosine, toBytes, fromBytes, LITE_DIM } from "@/lib/memory/embed-lite";
import { scoreCandidates, mmr, DEFAULT_WEIGHTS, NOSTALGIA_WEIGHTS, type Candidate } from "@/lib/memory/rank";
import { extractHeuristic, analyzeMood, resolveDue } from "@/lib/memory/heuristics";
import { computeStyle, describeStyle } from "@/lib/memory/style";
import { extractJson } from "@/lib/ai/json";

const DAY = 86_400_000;
const NOW = new Date("2026-11-03T12:00:00");

describe("lite 向量", () => {
  it("归一化且可序列化往返", () => {
    const v = embedLite("和阿哲在洱海看日出");
    expect(v.length).toBe(LITE_DIM);
    expect(cosine(v, v)).toBeCloseTo(1, 5);
    expect(cosine(fromBytes(toBytes(v))!, v)).toBeCloseTo(1, 5);
  });
  it("同主题文本比无关文本更相似", () => {
    const q = embedLite("洱海的日出");
    const near = embedLite("五点半在洱海边等日出，湖面变成粉色");
    const far = embedLite("加班到很晚，老板说设计不够细");
    expect(cosine(q, near)).toBeGreaterThan(cosine(q, far) + 0.15);
  });
});

describe("检索打分", () => {
  const mk = (id: string, content: string, importance: number, daysAgo: number, entities: string[] = []): Candidate => ({
    id,
    content,
    importance,
    occurredAt: new Date(NOW.getTime() - daysAgo * DAY),
    vec: embedLite(content),
    entityNames: entities,
  });
  const cands = [
    mk("erhai", "和阿哲在洱海等日出", 9, 90, ["阿哲", "洱海"]),
    mk("work", "加班到很晚", 5, 2),
    mk("cat", "年糕晒太阳", 4, 30, ["年糕"]),
  ];

  it("语义相关 + 实体命中的记忆排第一", () => {
    const s = scoreCandidates(cands, { vec: embedLite("又想去洱海了"), entities: ["洱海"], now: NOW });
    expect(s.sort((a, b) => b.score - a.score)[0].item.id).toBe("erhai");
  });

  it("时间衰减：同样内容，新的分更高；怀旧权重下差距缩小", () => {
    const a = mk("new", "去西湖骑车", 5, 1);
    const b = mk("old", "去西湖骑车", 5, 200);
    const [sa, sb] = scoreCandidates([a, b], { vec: null, entities: [], now: NOW }, DEFAULT_WEIGHTS);
    expect(sa.score).toBeGreaterThan(sb.score);
    const [na, nb] = scoreCandidates([a, b], { vec: null, entities: [], now: NOW }, NOSTALGIA_WEIGHTS);
    expect(na.score - nb.score).toBeLessThan(sa.score - sb.score);
  });

  it("MMR 去掉近似重复", () => {
    const dup = [mk("a", "和小鹿吃火锅", 7, 3), mk("b", "和小鹿吃火锅", 7, 3), mk("c", "妈妈来杭州看我", 6, 3)];
    const s = scoreCandidates(dup, { vec: embedLite("和小鹿吃火锅"), entities: [], now: NOW });
    const picked = mmr(s, 2, 0.5).map((x) => x.item.id);
    expect(picked).toContain("c");
  });
});

describe("规则抽取器", () => {
  it("识别人物、地点、计划与到期日", () => {
    const r = extractHeuristic(
      { text: "今天和阿哲去洱海看日出，好美！下周要考试了，有点焦虑。", occurredAt: NOW },
      [{ name: "年糕", type: "person" }],
    );
    const names = r.memories.flatMap((m) => m.entities.map((e) => e.name));
    expect(names).toContain("阿哲");
    expect(names).toContain("洱海");
    const plan = r.memories.find((m) => m.kind === "plan");
    expect(plan?.dueDate).toBe(new Date(NOW.getTime() + 7 * DAY).toISOString().slice(0, 10));
    expect(r.memories[0].content.startsWith("今天")).toBe(false);
  });

  it("情绪效价", () => {
    expect(analyzeMood("好开心，太幸福了").mood).toBeGreaterThan(0.3);
    expect(analyzeMood("好累，焦虑到失眠").mood).toBeLessThan(-0.3);
  });

  it("解析具体日期", () => {
    const d = resolveDue("12月25日要去面试", NOW)!;
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(25);
  });
});

describe("文风指纹", () => {
  it("提取口头禅与语气词", () => {
    const s = computeStyle([
      "哈哈哈今天好开心呀！",
      "救命，笑到肚子疼，哈哈哈。",
      "算了，慢慢来吧。",
      "慢慢来，总会好的吧。",
      "年糕又在睡觉呀。",
    ]);
    expect(s.catchphrases).toContain("哈哈哈");
    expect(s.catchphrases).toContain("慢慢来");
    expect(s.particles).toContain("吧");
    expect(describeStyle(s)).toContain("口头禅");
  });
});

describe("JSON 修复", () => {
  it("容忍代码块、前后废话和尾逗号", () => {
    expect(extractJson('好的，这是结果：\n```json\n{"a": 1, "b": [1,2,],}\n```')).toEqual({ a: 1, b: [1, 2] });
    expect(extractJson('{"title": “你好”}')).toEqual({ title: "你好" });
  });
  it("没有 JSON 时抛错", () => {
    expect(() => extractJson("抱歉我不能")).toThrow();
  });
});

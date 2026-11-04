import { describe, expect, it } from "vitest";
import { categoryItems, MEMORY_CATEGORIES, type MapMemory } from "@/lib/memory/map";

const person = { id: "mom", name: "妈妈", type: "person" };
const place = { id: "lake", name: "西湖", type: "place" };
const theme = { id: "travel", name: "旅行", type: "theme" };
function memory(id: string, kind: string, overrides: Partial<MapMemory> = {}): MapMemory {
  return { id, kind, content: id, status: "active", occurredAt: new Date("2026-11-01T00:00:00Z"), dueAt: null,
    resolved: false, entities: [], ...overrides };
}

describe("six-category memory map", () => {
  it("uses entity links across kinds, including legacy person/place memories, without duplicate people", () => {
    const memories = [memory("legacy", "person", { entities: [{ entity: person }] }),
      memory("event", "event", { entities: [{ entity: person }, { entity: person }, { entity: place }, { entity: theme }] }),
      memory("legacy-place", "place", { entities: [{ entity: place }] })];
    const people = categoryItems("people", memories);
    expect(people).toHaveLength(1);
    expect(people[0].memories.map((m) => m.id)).toEqual(["legacy", "event"]);
    expect(people[0].themes).toEqual(["旅行"]);
    expect(categoryItems("places", memories)[0].memories).toHaveLength(2);
    expect(categoryItems("events", memories)).toHaveLength(1);
    expect(MEMORY_CATEGORIES).toHaveLength(6);
  });

  it("merges goal and plan while keeping event, preference and fact separate", () => {
    const memories = ["goal", "plan", "event", "preference", "fact", "person", "place"].map((kind) => memory(kind, kind));
    expect(categoryItems("goals", memories).map((item) => item.id).sort()).toEqual(["goal", "plan"]);
    expect(categoryItems("preferences", memories).map((item) => item.id)).toEqual(["preference"]);
    expect(categoryItems("facts", memories).map((item) => item.id)).toEqual(["fact"]);
    expect(categoryItems("events", memories).map((item) => item.id)).toEqual(["event"]);
  });

  it("excludes retracted memories and entities linked only to retracted memories", () => {
    const memories = [memory("gone", "fact", { status: "retracted", entities: [{ entity: person }, { entity: theme }] })];
    for (const category of MEMORY_CATEGORIES) expect(categoryItems(category.id, memories)).toEqual([]);
  });

  it("sorts entities by latest active mention and ignores later retractions", () => {
    const other = { ...person, id: "friend", name: "小鹿" };
    const memories = [memory("old", "event", { entities: [{ entity: person }] }),
      memory("recent", "event", { occurredAt: new Date("2026-11-03"), entities: [{ entity: other }] }),
      memory("withdrawn", "event", { occurredAt: new Date("2026-11-04"), status: "retracted", entities: [{ entity: person }] })];
    expect(categoryItems("people", memories).map((item) => item.id)).toEqual(["friend", "mom"]);
  });
});

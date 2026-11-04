export const MEMORY_CATEGORIES = [
  { id: "people", title: "人物", description: "记住的人", intro: "小局记住的那些重要的人", unit: "人", type: "person", kinds: [], color: "#c58e74" },
  { id: "places", title: "地点", description: "去过或提及的地方", intro: "生活里留下足迹的地方", unit: "个地方", type: "place", kinds: [], color: "#c9a04e" },
  { id: "events", title: "经历", description: "发生过的重要事情", intro: "那些值得记住的生活片段", unit: "段经历", type: "", kinds: ["event"], color: "#8e9d78" },
  { id: "preferences", title: "兴趣与偏好", description: "喜欢的事物", intro: "让日子闪闪发光的小小热爱", unit: "条偏好", type: "", kinds: ["preference"], color: "#cf927a" },
  { id: "goals", title: "计划与目标", description: "正在努力的事情", intro: "一步一步，走向想去的未来", unit: "个计划", type: "", kinds: ["goal", "plan"], color: "#7ba0a0" },
  { id: "facts", title: "重要事实", description: "关于你的关键信息", intro: "你告诉小局的那些关于自己的事", unit: "条事实", type: "", kinds: ["fact"], color: "#c6a05f" },
] as const;

export type CategoryId = typeof MEMORY_CATEGORIES[number]["id"];
export const findCategory = (id: string) => MEMORY_CATEGORIES.find((category) => category.id === id);

export interface MapMemory {
  id: string;
  kind: string;
  content: string;
  status: string;
  occurredAt: Date;
  dueAt: Date | null;
  resolved: boolean;
  entities: Array<{ entity: { id: string; name: string; type: string } }>;
}

export interface MapItem {
  id: string;
  title: string;
  memories: MapMemory[];
  latest: Date;
  themes: string[];
}

/** Legacy person/place memories participate through their entity links, without rewriting data. */
export function categoryItems(categoryId: CategoryId, memories: MapMemory[]): MapItem[] {
  const category = findCategory(categoryId)!;
  const active = memories.filter((memory) => memory.status === "active");
  const groups = new Map<string, { title: string; memories: MapMemory[] }>();
  for (const memory of active) {
    if (category.type) {
      for (const { entity } of memory.entities) {
        if (entity.type !== category.type) continue;
        const group = groups.get(entity.id) ?? { title: entity.name, memories: [] };
        if (!group.memories.some((item) => item.id === memory.id)) group.memories.push(memory);
        groups.set(entity.id, group);
      }
    } else if ((category.kinds as readonly string[]).includes(memory.kind)) {
      groups.set(memory.id, { title: memory.content, memories: [memory] });
    }
  }
  return [...groups].map(([id, group]) => {
    const sorted = [...group.memories].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
    return { id, title: group.title, memories: sorted, latest: sorted[0].occurredAt,
      themes: [...new Set(sorted.flatMap((memory) => memory.entities.filter(({ entity }) => entity.type === "theme").map(({ entity }) => entity.name)))],
    };
  }).sort((a, b) => b.latest.getTime() - a.latest.getTime() || a.title.localeCompare(b.title, "zh-CN"));
}

export function mapDate(date: Date | string) {
  return new Date(date).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric" });
}

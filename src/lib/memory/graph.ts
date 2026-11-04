import type { GraphData } from "@/components/memory/MemoryGraph";

interface GraphMemory {
  status: string;
  entities: Array<{ entity: { id: string; name: string; type: string } }>;
}

/** Count only active links, even when withdrawn provenance is retained. */
export function buildMemoryGraph(name: string, memories: GraphMemory[]): GraphData {
  const entities = new Map<string, { id: string; name: string; type: string; count: number }>();
  const co = new Map<string, number>();
  for (const memory of memories.filter((m) => m.status === "active")) {
    const unique = new Map(memory.entities.map(({ entity }) => [entity.id, entity]));
    for (const entity of unique.values()) {
      const current = entities.get(entity.id);
      entities.set(entity.id, { ...entity, count: (current?.count ?? 0) + 1 });
    }
    const ids = [...unique.keys()].sort();
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const key = JSON.stringify([ids[i], ids[j]]);
      co.set(key, (co.get(key) ?? 0) + 1);
    }
  }
  return {
    nodes: [{ id: "me", name, type: "me", val: 10 }, ...[...entities.values()].map((e) => ({
      id: e.id, name: e.name, type: e.type, val: 2 + e.count * 1.5,
    }))],
    links: [
      ...[...entities.values()].map((e) => ({ source: "me", target: e.id, value: e.count })),
      ...[...co.entries()].map(([key, value]) => {
        const [source, target] = JSON.parse(key) as [string, string];
        return { source, target, value };
      }),
    ],
  };
}

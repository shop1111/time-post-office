import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ACTIVE_MEMORY } from "@/lib/memory/consistency";
import { categoryItems, findCategory } from "@/lib/memory/map";
import { CategoryList } from "@/components/memory/CategoryList";

export default async function MemoryCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category: id } = await params;
  const category = findCategory(id);
  if (!category) notFound();
  const memories = await db.memory.findMany({ where: ACTIVE_MEMORY, include: { entities: { include: { entity: true } } } });
  const items = categoryItems(category.id, memories);
  return <CategoryList categoryId={category.id} items={items.map((item) => ({
    id: item.id, title: item.title, summary: item.memories[0].content,
    count: item.memories.length, latest: item.latest.toISOString(), themes: item.themes,
  }))} />;
}

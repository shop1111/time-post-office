"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Search } from "lucide-react";
import { categoryIcons } from "./MemoryArt";
import { MemorySort } from "./MemorySort";
import { findCategory, mapDate, type CategoryId } from "@/lib/memory/map";

interface ListItem { id: string; title: string; summary: string; count: number; latest: string; themes: string[] }

export function CategoryList({ categoryId, items }: { categoryId: CategoryId; items: ListItem[] }) {
  const category = findCategory(categoryId)!;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const Icon = categoryIcons[categoryId];
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(`memory.filters:${categoryId}`) ?? "null");
      if (typeof saved?.query === "string") setQuery(saved.query);
      if (["recent", "count", "name"].includes(saved?.sort)) setSort(saved.sort);
    } catch { /* Use the defaults if session storage is unavailable. */ }
  }, [categoryId]);
  function updateFilters(nextQuery: string, nextSort: string) {
    setQuery(nextQuery);
    setSort(nextSort);
    try { sessionStorage.setItem(`memory.filters:${categoryId}`, JSON.stringify({ query: nextQuery, sort: nextSort })); } catch { /* Filtering works without storage. */ }
  }
  const filtered = items.filter((item) => `${item.title} ${item.summary} ${item.themes.join(" ")}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => sort === "count" ? b.count - a.count : sort === "name" ? a.title.localeCompare(b.title, "zh-CN") : b.latest.localeCompare(a.latest));

  return <div className="mx-auto max-w-3xl space-y-6">
    <Link href="/memory" className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink"><ArrowLeft size={14} /> 返回记忆地图</Link>
    <header>
      <h1 className="font-hand text-3xl">{category.title}</h1>
      <p className="mt-2 text-sm text-ink-2">{category.intro} · {items.length} {category.unit}</p>
    </header>
    <div className="mb-5 flex flex-wrap gap-3">
      <label className="relative min-w-40 flex-1"><span className="sr-only">搜索{category.title}</span><Search className="absolute left-3 top-3 text-ink-3" size={18} /><input className="input !pl-10 text-sm" placeholder={`搜索${category.title}…`} value={query} onChange={(event) => updateFilters(event.target.value, sort)} /></label>
      <MemorySort value={sort} onChange={(value) => updateFilters(query, value)} />
    </div>
    <ul className="card divide-y divide-line p-5">
      {filtered.map((item) => <li key={item.id}><Link href={`/memory/${categoryId}/${encodeURIComponent(item.id)}`} className="group flex items-center gap-3 py-4">
        <Icon size={20} className="shrink-0 text-ink-3" />
        <div className="min-w-0 flex-1"><h2 className="line-clamp-2 font-semibold group-hover:text-stamp">{item.title}</h2><p className="mt-1 text-xs text-ink-3">{item.count} 条记忆 · 最近 {mapDate(item.latest)}</p><p className="mt-1.5 line-clamp-1 text-sm text-ink-2">{item.summary}</p>
          {item.themes.length > 0 && <p className="mt-2 flex flex-wrap gap-1">{item.themes.slice(0, 3).map((theme) => <span key={theme} className="chip justify-center text-center leading-5">{theme}</span>)}</p>}
        </div><ChevronRight size={19} className="shrink-0 text-ink-3" />
      </Link></li>)}
    </ul>
    {!filtered.length && <div className="py-14 text-center text-sm text-ink-3"><p>{query ? "没有找到相关记忆，换个关键词试试。" : "这里的故事，还在慢慢收集。"}</p>{!query && <Link href="/capsules/new" className="btn btn-ghost mt-5">记下今天的生活</Link>}</div>}
  </div>;
}

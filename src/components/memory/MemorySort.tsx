"use client";

import { useRef } from "react";
import { Check, ChevronDown } from "lucide-react";

const options = [{ value: "recent", label: "最近提及" }, { value: "count", label: "记忆最多" }, { value: "name", label: "名称排序" }];

export function MemorySort({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const menu = useRef<HTMLDetailsElement>(null);
  return <details ref={menu} className="relative shrink-0" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
  }} onKeyDown={(event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      menu.current!.open = false;
      menu.current?.querySelector("summary")?.focus();
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      menu.current!.open = true;
      const buttons = [...menu.current!.querySelectorAll("button")];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  }}>
    <summary aria-label="排列方式" className="input relative flex h-11 min-w-32 cursor-pointer list-none items-center justify-center !px-8 !py-0 text-center text-sm leading-6 [&::-webkit-details-marker]:hidden">
      <span>{options.find((option) => option.value === value)?.label}</span><ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3" />
    </summary>
    <div role="menu" aria-label="排列方式" className="card absolute right-0 top-full z-20 mt-2 min-w-40 overflow-hidden p-1.5">
      {options.map((option) => <button key={option.value} role="menuitemradio" aria-checked={value === option.value} className={`relative flex min-h-11 w-full items-center justify-center rounded-lg px-8 py-2 text-center text-sm leading-6 hover:bg-paper-2 focus:bg-paper-2 focus:outline-none ${value === option.value ? "bg-paper-2 text-ink" : "text-ink-2"}`} onClick={() => {
        onChange(option.value);
        menu.current!.open = false;
        menu.current?.querySelector("summary")?.focus();
      }}>{option.label}{value === option.value && <Check size={15} className="absolute right-3 top-1/2 -translate-y-1/2" />}</button>)}
    </div>
  </details>;
}

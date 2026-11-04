import { BookOpen, Camera, Layers, MapPin, Target, UsersRound, type LucideIcon } from "lucide-react";
import type { CategoryId } from "@/lib/memory/map";

export const categoryIcons: Record<CategoryId, LucideIcon> = {
  people: UsersRound, places: MapPin, events: BookOpen, preferences: Camera, goals: Target, facts: Layers,
};

/** Decorative paper illustrations, kept as native vectors for crisp responsive rendering. */
export function MemoryArt({ category, className = "" }: { category: CategoryId; className?: string }) {
  return <svg viewBox="0 0 180 130" aria-hidden="true" className={`memory-art ${className}`} fill="none" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="91" cy="98" rx="73" ry="22" fill="currentColor" opacity=".08" />
    {category === "people" && <g stroke="#b78369" strokeWidth="1.6">
      {[{ x: 30, y: 32, r: -9 }, { x: 77, y: 24, r: 6 }, { x: 99, y: 51, r: 15 }].map(({ x, y, r }) => <g key={x} transform={`translate(${x} ${y}) rotate(${r} 30 35)`}><rect width="58" height="70" rx="3" fill="#fff7e9" /><rect x="6" y="6" width="46" height="46" rx="2" fill="#ebc7af" /><circle cx="29" cy="24" r="10" fill="#cfa087" stroke="none" /><path d="M12 50q1-19 17-19t17 19" fill="#cfa087" stroke="none" /></g>)}
    </g>}
    {category === "places" && <g><path d="M6 80 43 45 65 57 102 20 130 44 147 39 175 79" fill="#b4c5be" opacity=".65" /><path d="m12 85 42-25 24 13 39-27 55 39" fill="#9ab3a7" opacity=".6" /><path d="M8 89q40-9 80 0t84 0l-24 22H41Z" fill="#afc9c7" opacity=".7" /><path d="M57 100h57m-39 9h52" stroke="#fff7ed" strokeWidth="2" /><path d="m95 28 7-8 12 13-12-4-7 5" fill="#f6f0e1" /></g>}
    {category === "preferences" && <g stroke="#a7a174" strokeWidth="1.5"><path d="M47 111Q87 76 134 27M76 86l-9-42m31 20 39 4m-20-21 1-25" /><path d="M73 71Q39 65 39 43q31-6 34 28ZM91 72q22-28 48-13-9 26-48 13ZM105 50Q78 42 81 22q26-1 24 28Z" fill="#a5ad80" opacity=".7" />{[[69, 47], [81, 64], [100, 53], [115, 32], [130, 42], [97, 83], [67, 91]].map(([x, y]) => <g key={`${x}-${y}`} transform={`translate(${x} ${y})`} stroke="#d2ad65" fill="#e9c581"><ellipse cx="-4" cy="-3" rx="5" ry="3" transform="rotate(30)" /><ellipse cx="4" cy="-3" rx="5" ry="3" transform="rotate(-30)" /><ellipse cy="4" rx="3" ry="5" /><circle r="2" fill="#b8914a" /></g>)}</g>}
    {category === "events" && <g stroke="#8c887a" strokeWidth="2" transform="rotate(-5 90 70)"><path d="M34 49h24l7-12h39l7 12h32v55H34Z" fill="#d4c8ad" /><rect x="35" y="61" width="107" height="30" fill="#9b9283" /><circle cx="88" cy="76" r="29" fill="#e9dcc1" /><circle cx="88" cy="76" r="22" fill="#777e77" /><circle cx="88" cy="76" r="15" fill="#b0bcb5" /><circle cx="82" cy="70" r="5" fill="#e6ede0" /><rect x="119" y="52" width="15" height="9" rx="2" fill="#eee6d6" /><path d="M43 42h12v7H43" /></g>}
    {category === "goals" && <g transform="rotate(9 90 65)" stroke="#bb9c70" strokeWidth="1.8"><rect x="50" y="20" width="83" height="100" rx="4" fill="#fff7e5" /><path d="M74 20v-4h34v4" /><rect x="76" y="17" width="29" height="10" rx="3" fill="#d8bd8e" />{[43, 67, 91].map((y) => <g key={y}><rect x="62" y={y} width="12" height="12" rx="1" /><path d={`m64 ${y + 5} 4 4 7-10m7 6h33m-33 6h24`} /></g>)}</g>}
    {category === "facts" && <g stroke="#b4946a" strokeWidth="1.8"><path d="m35 95 91-10 24 13-91 12-24-7Z" fill="#c99b73" /><path d="m45 75 93-8 11 14-93 10-11-7Z" fill="#e3c28a" /><path d="m35 55 90-9 30 13-91 11-29-7Z" fill="#bbbba0" /><path d="m59 72 91-11v7L59 80Zm-1 22 87-10v8l-87 10Z" fill="#fff4d9" /><path d="m65 110 82-11v7l-82 11Z" fill="#f5e3bf" /></g>}
  </svg>;
}


/**
 * 示例数据的「照片」：程序生成的插画（SVG），避免版权问题，也无需额外资源文件。
 */
type Scene = (w: number, h: number) => string;

const hills = (w: number, h: number, y: number, amp: number, color: string, seed: number) => {
  let d = `M0 ${h} L0 ${y}`;
  for (let x = 0; x <= w; x += w / 8) {
    const yy = y - Math.abs(Math.sin((x / w) * Math.PI * 2 + seed)) * amp - Math.sin(seed * 3 + x / 90) * amp * 0.3;
    d += ` Q ${x - w / 16} ${yy - amp * 0.4} ${x} ${yy}`;
  }
  return `<path d="${d} L${w} ${h} Z" fill="${color}"/>`;
};

const grain = `<filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.09 0"/></filter>`;

const SCENES: Record<string, Scene> = {
  // 洱海日出
  "erhai-sunrise": (w, h) => `
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2d3a6b"/><stop offset=".45" stop-color="#e88a6a"/><stop offset=".62" stop-color="#ffd59a"/></linearGradient>
    <linearGradient id="w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f5b98a"/><stop offset="1" stop-color="#3a4f7a"/></linearGradient>${grain}</defs>
    <rect width="${w}" height="${h}" fill="url(#s)"/>
    <circle cx="${w * 0.62}" cy="${h * 0.58}" r="${h * 0.09}" fill="#fff1c9"/>
    ${hills(w, h, h * 0.6, h * 0.12, "#5b4a6e", 1.2)}
    <rect y="${h * 0.62}" width="${w}" height="${h * 0.38}" fill="url(#w)"/>
    ${Array.from({ length: 9 }, (_, i) => `<rect x="${w * 0.5 + (i % 3) * 18 - 30}" y="${h * 0.66 + i * 16}" width="${120 - i * 10}" height="3" fill="#fff1c9" opacity="${0.7 - i * 0.07}"/>`).join("")}
    <g fill="#1d2440"><rect x="${w * 0.18}" y="${h * 0.7}" width="4" height="${h * 0.12}"/><path d="M${w * 0.15} ${h * 0.82} h${w * 0.08} l-10 14 h-${w * 0.06} z"/></g>
    <rect width="${w}" height="${h}" filter="url(#g)"/>`,
  // 苍山日落 / 古城
  "cangshan-dusk": (w, h) => `
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb37a"/><stop offset=".5" stop-color="#f27b6b"/><stop offset="1" stop-color="#7a4a78"/></linearGradient>${grain}</defs>
    <rect width="${w}" height="${h}" fill="url(#s)"/>
    <circle cx="${w * 0.3}" cy="${h * 0.42}" r="${h * 0.11}" fill="#ffe2a8" opacity=".9"/>
    ${hills(w, h, h * 0.5, h * 0.2, "#8a4f7d", 0.4)}
    ${hills(w, h, h * 0.66, h * 0.1, "#5a3560", 2.1)}
    <g fill="#2a1c33">${Array.from({ length: 12 }, (_, i) => { const x = i * (w / 12); const hh = 40 + ((i * 37) % 50); return `<rect x="${x}" y="${h - hh - 40}" width="${w / 12 - 6}" height="${hh + 40}"/><path d="M${x - 8} ${h - hh - 40} L${x + w / 24 - 3} ${h - hh - 66} L${x + w / 12 + 2} ${h - hh - 40}Z"/>`; }).join("")}</g>
    ${Array.from({ length: 14 }, (_, i) => `<circle cx="${(i * 61) % w}" cy="${h - 30 - ((i * 23) % 60)}" r="3" fill="#ffd27a"/>`).join("")}
    <rect width="${w}" height="${h}" filter="url(#g)"/>`,
  // 西湖骑行
  "westlake-bike": (w, h) => `
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe3f0"/><stop offset="1" stop-color="#f4f1e6"/></linearGradient>${grain}</defs>
    <rect width="${w}" height="${h}" fill="url(#s)"/>
    ${hills(w, h, h * 0.45, h * 0.08, "#9fb8a8", 0.8)}
    <rect y="${h * 0.48}" width="${w}" height="${h * 0.2}" fill="#9cc7d4"/>
    <path d="M${w * 0.55} ${h * 0.47} q 20 -30 40 0 M${w * 0.6} ${h * 0.47} v-28 l8 -6 l8 6 v28" stroke="#6d7d77" stroke-width="3" fill="none"/>
    <rect y="${h * 0.68}" width="${w}" height="${h * 0.32}" fill="#d9cfb4"/>
    ${Array.from({ length: 6 }, (_, i) => `<g transform="translate(${60 + i * 140} ${h * 0.66})"><rect x="-3" y="-90" width="6" height="90" fill="#6b5a46"/><circle cy="-100" r="42" fill="#7fae7a" opacity=".85"/><path d="M-30 -80 q 10 50 4 100 M28 -78 q -6 50 -2 100" stroke="#8fbf86" stroke-width="2" fill="none"/></g>`).join("")}
    <g stroke="#3b3b3b" stroke-width="5" fill="none"><circle cx="${w * 0.4}" cy="${h * 0.86}" r="34"/><circle cx="${w * 0.53}" cy="${h * 0.86}" r="34"/><path d="M${w * 0.4} ${h * 0.86} l40 -46 h40 l14 46 M${w * 0.45} ${h * 0.79} h55"/></g>
    <rect width="${w}" height="${h}" filter="url(#g)"/>`,
  // 晒太阳的猫
  "cat-sun": (w, h) => `
    <defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7e3c4"/><stop offset="1" stop-color="#e9c99b"/></linearGradient>${grain}</defs>
    <rect width="${w}" height="${h}" fill="url(#s)"/>
    <path d="M0 0 L${w * 0.55} 0 L${w} ${h * 0.75} L${w} ${h} L${w * 0.25} ${h}Z" fill="#fff6e0" opacity=".55"/>
    <g stroke="#c9a77a" stroke-width="10" opacity=".4"><line x1="${w * 0.2}" y1="0" x2="${w * 0.75}" y2="${h}"/><line x1="${w * 0.36}" y1="0" x2="${w * 0.91}" y2="${h}"/></g>
    <g transform="translate(${w * 0.5} ${h * 0.68})">
      <ellipse rx="150" ry="70" fill="#f0f0ea"/><ellipse cx="-30" cy="-10" rx="60" ry="40" fill="#e3a65c"/>
      <circle cx="120" cy="-30" r="58" fill="#f0f0ea"/><path d="M80 -70 l10 -40 l25 32 M140 -78 l20 -36 l14 42" fill="#f0f0ea"/>
      <path d="M100 -30 q 10 8 20 0 M135 -30 q 10 8 20 0" stroke="#4a3b30" stroke-width="3" fill="none"/>
      <path d="M-150 10 q -60 30 -20 60" stroke="#e3a65c" stroke-width="22" fill="none" stroke-linecap="round"/>
    </g>
    <rect width="${w}" height="${h}" filter="url(#g)"/>`,
  // 桂花
  osmanthus: (w, h) => `
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e8efe0"/><stop offset="1" stop-color="#f6ecd2"/></linearGradient>${grain}</defs>
    <rect width="${w}" height="${h}" fill="url(#s)"/>
    <path d="M${w * 0.1} ${h} C ${w * 0.3} ${h * 0.6}, ${w * 0.5} ${h * 0.5}, ${w} ${h * 0.2}" stroke="#6b5040" stroke-width="10" fill="none"/>
    ${Array.from({ length: 26 }, (_, i) => { const x = (i * 97) % w; const y = (i * 53) % (h * 0.8) + 40; return `<ellipse cx="${x}" cy="${y}" rx="38" ry="16" transform="rotate(${(i * 40) % 180} ${x} ${y})" fill="#5f8a55" opacity=".85"/>`; }).join("")}
    ${Array.from({ length: 70 }, (_, i) => `<circle cx="${(i * 131) % w}" cy="${(i * 71) % h}" r="${4 + (i % 3)}" fill="${i % 4 ? "#f2b33d" : "#f7cf6b"}"/>`).join("")}
    <rect width="${w}" height="${h}" filter="url(#g)"/>`,
  // 摄影展
  gallery: (w, h) => `
    <defs>${grain}</defs>
    <rect width="${w}" height="${h}" fill="#ece8e1"/><rect y="${h * 0.78}" width="${w}" height="${h * 0.22}" fill="#cfc6b8"/>
    ${[0.12, 0.42, 0.72].map((x, i) => `<rect x="${w * x}" y="${h * 0.2}" width="${w * 0.18}" height="${h * 0.32}" fill="#fff" stroke="#bdb3a3"/><rect x="${w * x + 12}" y="${h * 0.2 + 12}" width="${w * 0.18 - 24}" height="${h * 0.32 - 24}" fill="${["#7a8fa6", "#c98a6b", "#6f8b6a"][i]}"/>`).join("")}
    <g transform="translate(${w * 0.5} ${h * 0.6})" fill="#3b3a44"><circle cy="-60" r="22"/><path d="M-28 -36 h56 l12 110 h-80z"/></g>
    <rect width="${w}" height="${h}" filter="url(#g)"/>`,
  // 火锅
  hotpot: (w, h) => `
    <defs><radialGradient id="p"><stop offset="0" stop-color="#e2452f"/><stop offset="1" stop-color="#9c2a1c"/></radialGradient>${grain}</defs>
    <rect width="${w}" height="${h}" fill="#3a2a26"/><ellipse cx="${w / 2}" cy="${h * 0.58}" rx="${w * 0.36}" ry="${h * 0.3}" fill="#c8c2ba"/>
    <ellipse cx="${w / 2}" cy="${h * 0.56}" rx="${w * 0.31}" ry="${h * 0.24}" fill="url(#p)"/>
    ${Array.from({ length: 30 }, (_, i) => `<circle cx="${w / 2 + Math.cos(i) * (i * 6)}" cy="${h * 0.56 + Math.sin(i * 1.7) * (i * 2.6)}" r="${4 + (i % 4) * 2}" fill="${["#f6d36b", "#7bb06a", "#f3efe6", "#e48a4a"][i % 4]}"/>`).join("")}
    <path d="M${w * 0.4} ${h * 0.2} q 20 -40 0 -80 M${w * 0.55} ${h * 0.22} q -20 -40 0 -80" stroke="#fff" stroke-opacity=".25" stroke-width="8" fill="none"/>
    <rect width="${w}" height="${h}" filter="url(#g)"/>`,
};

export const SCENE_NAMES = Object.keys(SCENES);

export function renderScene(name: string, w = 800, h = 600): string | null {
  const s = SCENES[name];
  if (!s) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${s(w, h)}</svg>`;
}

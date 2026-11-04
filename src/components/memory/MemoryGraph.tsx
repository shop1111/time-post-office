"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false, loading: () => <div className="h-full animate-pulse rounded-2xl bg-paper-2" /> });

export interface GraphNode {
  id: string;
  name: string;
  type: string;
  val: number;
}
export interface GraphData {
  nodes: GraphNode[];
  links: Array<{ source: string; target: string; value: number }>;
}

const COLOR: Record<string, string> = { me: "#c0483a", person: "#c98a6b", place: "#2f5d62", theme: "#c9973f" };

export function MemoryGraph({ data }: { data: GraphData }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const router = useRouter();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fg = useRef<any>(null);
  const fitted = useRef(false);
  useEffect(() => {
    fitted.current = false;
  }, [data]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [data.nodes.length]);
  const dark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

  if (data.nodes.length <= 1) return <div className="card p-6 text-sm text-ink-3">记录里出现的人、地点和主题，会在这里连成一张网。</div>;

  return (
    <div ref={box} className="card relative h-[380px] overflow-hidden">
      <ForceGraph2D
        ref={fg}
        width={w}
        height={380}
        graphData={data}
        cooldownTicks={120}
        d3VelocityDecay={0.3}
        onEngineTick={() => {
          const g = fg.current;
          if (g && !g.__tuned) {
            g.__tuned = true;
            g.d3Force("charge")?.strength(-260);
            g.d3Force("link")?.distance(70);
          }
        }}
        onEngineStop={() => {
          if (!fitted.current) {
            fitted.current = true;
            fg.current?.zoomToFit(500, 50);
          }
        }}
        nodeRelSize={4}
        linkColor={() => (dark ? "rgba(255,255,255,0.12)" : "rgba(80,60,40,0.15)")}
        linkWidth={(l) => Math.min(4, 0.5 + Number(l.value) * 0.6)}
        onNodeClick={(n) => {
          if (n.type !== "me") router.push(`/timeline?tag=${encodeURIComponent(String(n.name))}`);
        }}
        nodeCanvasObject={(node, ctx, scale) => {
          const r = Math.sqrt(Number(node.val)) * 3;
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
          ctx.fillStyle = COLOR[String(node.type)] ?? "#999";
          ctx.globalAlpha = node.type === "me" ? 1 : 0.85;
          ctx.fill();
          ctx.globalAlpha = 1;
          const fs = Math.max(10, 13 / scale);
          ctx.font = `${node.type === "me" ? "bold " : ""}${fs}px "PingFang SC","Microsoft YaHei",sans-serif`;
          ctx.textAlign = "center";
          ctx.fillStyle = dark ? "#efe6d6" : "#2f2a24";
          ctx.fillText(String(node.name), node.x!, node.y! + r + fs);
        }}
      />
      <div className="absolute bottom-3 left-3 flex gap-3 text-[11px] text-ink-3">
        {[
          ["person", "人物"],
          ["place", "地点"],
          ["theme", "主题"],
        ].map(([k, l]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR[k] }} /> {l}
          </span>
        ))}
        <span>· 点击节点查看相关记录</span>
      </div>
    </div>
  );
}

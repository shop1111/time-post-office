import { renderScene } from "@/lib/demo/scenes";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const svg = renderScene(name);
  if (!svg) return new Response("not found", { status: 404 });
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
}

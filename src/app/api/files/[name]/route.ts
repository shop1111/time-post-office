import { readUpload, mimeOf } from "@/lib/files";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  try {
    const buf = await readUpload(name);
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": mimeOf(name), "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

import { withUser } from "@/lib/auth";
import { readUpload, mimeOf } from "@/lib/files";

export const runtime = "nodejs";

async function handleGET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  try {
    const buf = await readUpload(name);
    return new Response(new Uint8Array(buf), { headers: { "Content-Type": mimeOf(name), "Cache-Control": "private, max-age=31536000, immutable" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

export const GET = withUser(handleGET);

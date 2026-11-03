import { Readable } from "node:stream";
import { openUpload, byteRange, mimeOf } from "@/lib/files";

export const runtime = "nodejs";

async function respond(req: Request, { params }: { params: Promise<{ name: string }> }, head = false) {
  const { name } = await params;
  const headers = new Headers({ "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=31536000, immutable", "Content-Length": "0" });
  try {
    const { file, size } = await openUpload(name);
    let handedToStream = false;
    try {
      headers.set("Content-Type", mimeOf(name));
      const requested = req.headers.get("range");
      const range = requested === null ? undefined : byteRange(requested, size);
      if (range === null) {
        headers.set("Content-Range", `bytes */${size}`);
        return new Response(null, { status: 416, headers });
      }
      const start = range?.start ?? 0, end = range?.end ?? size - 1;
      headers.set("Content-Length", String(size ? end - start + 1 : 0));
      if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
      const status = range ? 206 : 200;
      if (head || !size) return new Response(null, { status, headers });
      const stream = file.createReadStream({ start, end, autoClose: true, signal: req.signal });
      handedToStream = true;
      return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers });
    } finally { if (!handedToStream) await file.close(); }
  } catch {
    headers.set("Content-Length", "0");
    headers.set("Cache-Control", "private, no-store");
    return new Response(null, { status: 404, headers });
  }
}

export const GET = (req: Request, context: { params: Promise<{ name: string }> }) => respond(req, context);
export const HEAD = (req: Request, context: { params: Promise<{ name: string }> }) => respond(req, context, true);

import { diagnostics } from "@/lib/diagnostics";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() { return Response.json(await diagnostics(), { headers: { "Cache-Control": "no-store" } }); }

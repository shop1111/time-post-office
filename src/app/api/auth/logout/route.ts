import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { cookieOptions, destroySession, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: Request) {
  await destroySession((await cookies()).get(SESSION_COOKIE)?.value);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", cookieOptions(req, new Date(0)));
  return res;
}

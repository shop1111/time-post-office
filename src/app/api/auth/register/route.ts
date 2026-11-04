import { NextResponse } from "next/server";
import { cookieOptions, createSession, registerUser, RegistrationError, SESSION_COOKIE } from "@/lib/auth";
import { clientKey, rateLimit } from "@/lib/curator/guard";

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!rateLimit(`register:${clientKey(req)}`, 5, 2)) return NextResponse.json({ error: "操作太频繁，稍后再试" }, { status: 429 });
  const body = (await req.json().catch(() => ({}))) as { username?: unknown; password?: unknown; invite?: unknown };
  try {
    const user = await registerUser(body);
    const { token, expiresAt } = await createSession(user.id);
    const res = NextResponse.json({ ok: true, username: user.username });
    res.cookies.set(SESSION_COOKIE, token, cookieOptions(req, expiresAt));
    return res;
  } catch (e) {
    if (e instanceof RegistrationError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[auth] register failed", e);
    return NextResponse.json({ error: "注册失败，请稍后再试" }, { status: 500 });
  }
}

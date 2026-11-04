import { NextResponse } from "next/server";
import { authenticate, cookieOptions, createSession, normalizeUsername, SESSION_COOKIE } from "@/lib/auth";
import { clientKey, rateLimit } from "@/lib/curator/guard";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
  const name = normalizeUsername(body.username) ?? "?";
  // 按 IP 和按账号分别限流，防止暴力猜密码
  if (!rateLimit(`login:${clientKey(req)}`, 10, 5) || !rateLimit(`login-user:${name}`, 10, 3)) {
    return NextResponse.json({ error: "尝试次数太多，稍后再试" }, { status: 429 });
  }
  const user = await authenticate(body.username, body.password);
  if (!user) return NextResponse.json({ error: "用户名或密码不对" }, { status: 401 });
  const { token, expiresAt } = await createSession(user.id);
  const res = NextResponse.json({ ok: true, username: user.username });
  res.cookies.set(SESSION_COOKIE, token, cookieOptions(req, expiresAt));
  return res;
}

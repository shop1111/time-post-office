import crypto from "crypto";
import { promisify } from "util";
import { cache, type ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authDb, provisionUserDb, runAsUser } from "./tenancy";
import { normalizeUsername } from "./username";

export const SESSION_COOKIE = "tpo_session";
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 86_400_000;

const scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number, options: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export interface SessionUser { id: string; username: string }

// ———————————————————— 密码 ————————————————————

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, 64, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string) {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64"), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

export { normalizeUsername };

export function validatePassword(raw: unknown) {
  if (typeof raw !== "string") return "请输入密码";
  if (raw.length < 8) return "密码至少 8 位";
  if (raw.length > 128) return "密码太长了";
  return null;
}

// ———————————————————— 会话 ————————————————————

const tokenId = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_MS);
  await authDb.session.create({ data: { id: tokenId(token), userId, expiresAt } });
  // 顺手清理过期会话
  await authDb.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
  return { token, expiresAt };
}

export async function destroySession(token: string | undefined) {
  if (token) await authDb.session.deleteMany({ where: { id: tokenId(token) } });
}

/**
 * Cookie 是否加 Secure：经由 HTTPS（含反向代理转发的 x-forwarded-proto）访问时加上。
 * 这样既支持正式的 HTTPS 部署，也不会让「先用 http://IP:3000 试一下」时登录失效。
 */
export function cookieOptions(req: Request, expires: Date) {
  const forced = process.env.COOKIE_SECURE;
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? new URL(req.url).protocol.replace(":", "");
  const secure = forced === "1" ? true : forced === "0" ? false : proto === "https";
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", expires };
}

/** 读取当前请求的登录用户；同一次渲染里只查一次库 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await authDb.session.findUnique({ where: { id: tokenId(token) }, include: { user: { select: { id: true, username: true } } } });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await authDb.session.deleteMany({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session.user;
});

// ———————————————————— 注册 ————————————————————

export class RegistrationError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function registrationOpen() {
  return process.env.ALLOW_REGISTRATION !== "0";
}
export function inviteRequired() {
  return !!process.env.INVITE_CODE?.trim();
}

function sameSecret(a: string, b: string) {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

export async function registerUser(input: { username?: unknown; password?: unknown; invite?: unknown }) {
  if (!registrationOpen()) throw new RegistrationError(403, "暂不开放注册");
  const invite = process.env.INVITE_CODE?.trim();
  if (invite && (typeof input.invite !== "string" || !sameSecret(input.invite.trim(), invite))) throw new RegistrationError(403, "邀请码不对");
  const username = normalizeUsername(input.username);
  if (!username) throw new RegistrationError(400, "用户名需要 3~32 位，只能用字母、数字、下划线、点和短横线");
  const bad = validatePassword(input.password);
  if (bad) throw new RegistrationError(400, bad);
  const max = Number(process.env.MAX_USERS) || 0;
  if (max > 0 && await authDb.user.count() >= max) throw new RegistrationError(403, "注册名额已满");
  if (await authDb.user.findUnique({ where: { username }, select: { id: true } })) throw new RegistrationError(409, "这个用户名已经有人用了");
  const passwordHash = await hashPassword(input.password as string);
  const user = await authDb.user.create({ data: { username, passwordHash }, select: { id: true, username: true } })
    .catch((e: { code?: string }) => { if (e?.code === "P2002") throw new RegistrationError(409, "这个用户名已经有人用了"); throw e; });
  try {
    provisionUserDb(user.id);
  } catch (e) {
    await authDb.user.delete({ where: { id: user.id } }).catch(() => {});
    throw e;
  }
  return user;
}

export async function authenticate(usernameRaw: unknown, password: unknown): Promise<SessionUser | null> {
  const username = normalizeUsername(usernameRaw);
  if (!username || typeof password !== "string") return null;
  const user = await authDb.user.findUnique({ where: { username } });
  if (!user) {
    // 用户不存在时也算一次哈希，避免通过响应时间探测用户名
    await hashPassword(password);
    return null;
  }
  return (await verifyPassword(password, user.passwordHash)) ? { id: user.id, username: user.username } : null;
}

// ———————————————————— 包裹路由与页面 ————————————————————

export function unauthorized() {
  return Response.json({ error: "请先登录", code: "UNAUTHENTICATED" }, { status: 401 });
}

/** API 路由：未登录返回 401；已登录则在该用户自己的库里执行 */
export function withUser<A extends unknown[]>(handler: (...args: A) => Response | Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const user = await getSessionUser();
    if (!user) return unauthorized();
    return runAsUser(user.id, () => handler(...args));
  };
}

/** 页面（服务端组件）：未登录跳转登录页；已登录则在该用户自己的库里渲染 */
export function userPage<P>(page: (props: P) => ReactNode | Promise<ReactNode>) {
  return async (props: P): Promise<ReactNode> => {
    const user = await getSessionUser();
    if (!user) redirect("/login");
    return runAsUser(user.id, () => page(props));
  };
}

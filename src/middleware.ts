import { NextResponse, type NextRequest } from "next/server";

/**
 * 粗筛：没有登录 Cookie 的请求，页面跳到登录页，API 直接 401。
 * 会话是否有效由 withUser / userPage（src/lib/auth.ts）在服务端逐个请求校验。
 */
const PUBLIC_PAGES = ["/login", "/register", "/about"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC_PAGES.includes(pathname) || pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (req.cookies.has("tpo_session")) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "请先登录", code: "UNAUTHENTICATED" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // 静态资源不拦截
  matcher: ["/((?!_next/static|_next/image|favicon.ico|xiaoju/|.*\\.(?:png|jpg|jpeg|webp|svg|gif|ico|txt|webmanifest)$).*)"],
};

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { signToken, verifyToken } from '@/lib/auth/session';

const protectedRoutes = '/dashboard';

/**
 * 内存限流（规格书 S7.3）：登录 5 次/分钟；LLM 触发接口每课程每小时 ≤ 20 次；
 * 通用接口 100 次/分钟。单实例部署够用；多实例需换 Redis（规格明确不引入）。
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const WINDOW_MS = 60_000;

function rateLimit(key: string, limit: number, windowMs = WINDOW_MS): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

// 定期清理过期桶，避免内存无限增长
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) {
    if (b.resetAt < now) buckets.delete(k);
  }
}, 60_000);

function clientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function limitFor(request: NextRequest): { key: string; limit: number; windowMs?: number } | null {
  const { pathname } = request.nextUrl;

  // 登录/注册：5 次/分钟/IP
  if (pathname === "/api/auth/login" || pathname === "/api/auth/register") {
    return { key: `login:${clientIp(request)}`, limit: 5 };
  }

  // LLM 触发接口（分组求解与作业拆解）：每课程每小时 20 次
  const llmMatch = pathname.match(/^\/api\/(courses\/\d+\/(?:grouping\/run|task-plan\/generate)|groups\/\d+\/task-plan\/generate)/);
  if (llmMatch && request.method === "POST") {
    const courseOrGroup = llmMatch[1];
    return { key: `llm:${courseOrGroup}`, limit: 20, windowMs: 3_600_000 };
  }

  // 通用 API：100 次/分钟/IP
  if (pathname.startsWith("/api/")) {
    return { key: `api:${clientIp(request)}:${pathname}`, limit: 100 };
  }
  return null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 限流（先于业务，超限直接 429）
  const limit = limitFor(request);
  if (limit && !rateLimit(limit.key, limit.limit, limit.windowMs)) {
    return NextResponse.json(
      { error: "请求过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const sessionCookie = request.cookies.get("session");
  const isProtectedRoute = pathname.startsWith(protectedRoutes);

  if (isProtectedRoute && !sessionCookie) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }

  let res = NextResponse.next();

  if (sessionCookie && request.method === "GET") {
    try {
      const parsed = await verifyToken(sessionCookie.value);
      const expiresInOneDay = new Date(Date.now() + 24 * 60 * 60 * 1000);

      res.cookies.set({
        name: "session",
        value: await signToken({
          ...parsed,
          expires: expiresInOneDay.toISOString(),
        }),
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        expires: expiresInOneDay,
      });
    } catch (error) {
      console.error("Error updating session:", error);
      res.cookies.delete("session");
      if (isProtectedRoute) {
        return NextResponse.redirect(new URL("/sign-in", request.url));
      }
    }
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
  runtime: "nodejs",
};

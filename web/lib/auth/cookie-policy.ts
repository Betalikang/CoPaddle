/**
 * 会话 Cookie 的 Secure 策略（单一真源）。
 *
 * 背景：这条策略原先写了两份且互相冲突 ——
 *   lib/auth/session.ts 的 setSession() 用 `COOKIE_SECURE !== 'false'`（可关），
 *   middleware.ts 的 GET 续期却硬编码 `secure: true`（不可关）。
 * 结果是：在 COOKIE_SECURE=false 的纯 HTTP 部署（裸 IP 演示环境）里，登录能成功，
 * 但第一次 GET 续期就把 cookie 重写成 Secure，浏览器随后直接丢弃 —— 用户表现为
 * 「刚登进去，刷新一下就被踢回登录页」，而且日志里什么都看不到。
 *
 * 所以任何写 session cookie 的地方都必须从这里取，不得各自判断 env。
 *
 * 取值顺序：
 *   1. COOKIE_SECURE 显式写了 "true"/"false" —— 以它为准（逃生阀；
 *      反代终结 TLS、容器内自认 http 这类反向不一致的场景需要它）。
 *   2. 否则按 BASE_URL 的协议推断：https → Secure，http → 非 Secure。
 *      这是最不容易出错的一步：浏览器看到的就是 BASE_URL 那个协议，
 *      cookie 属性必须和它对齐，否则必然「登录成功但立刻失效」。
 *   3. 都没有 → 保守为 true（安全默认优先）。
 */
export function sessionCookieSecure(): boolean {
  const explicit = process.env.COOKIE_SECURE;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;

  const baseUrl = process.env.BASE_URL;
  if (baseUrl) return baseUrl.startsWith('https://');

  return true;
}
/**
 * 为验收脚本签一枚本地会话 cookie。
 *
 * 为什么需要它：design-check / contrast-audit / screenshots / a11y-check / perf-measure
 * 都要以某个身份进站，而它们拿到的只是一个 cookie 字符串或裸 JWT。
 * 手写 `npx tsx -e "..."` 每次都会踩同一个坑——signToken 的 payload 是
 * `{ user: { id }, expires }`，传成 `{ id }` 也能签出 token、也能通过 jwtVerify，
 * 但 `getSession()` 拿到的 `payload.user` 是 undefined，于是整站在线状态直接 401。
 * 那种失败看起来像「验收脚本坏了」，实际是 token 结构不对（本文档顶端这条就是踩坑记录）。
 *
 * 用法：
 *   npx tsx scripts/dev-token.ts 651            # 打印裸 JWT
 *   npx tsx scripts/dev-token.ts 651 --cookie   # 打印 session=<JWT>，可直接喂给验收脚本
 *
 * 前提：web/.env 里必须有 AUTH_SECRET，且与服务端进程用的是同一个值，
 * 否则服务端验签失败（脚本会提醒）。
 *
 * 两个必须知道的实现细节（都踩过）：
 * 1) lib/auth/session.ts:7 是 `const key = new TextEncoder().encode(process.env.AUTH_SECRET)`，
 *    模块加载那一刻就把密钥固化下来了。所以 **绝不能用静态 import**：那样 env 还没设，
 *    密钥会变成字符串 "undefined"，签出的 token 服务端一律验签失败。下面用动态 import。
 * 2) payload 必须是 `{ user: { id }, expires }`，不是 `{ id }`。
 *    `{ id }` 也能签出来、也能过 jwtVerify，但 getSession() 读 payload.user.id 会是 undefined。
 */
import { readFileSync } from 'node:fs';

function loadEnvSecret() {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  try {
    const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*AUTH_SECRET\s*=\s*(.+)$/.exec(line);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    /* 没有 .env 就走下面的报错 */
  }
  return null;
}

const secret = loadEnvSecret();
if (!secret) {
  console.error(
    '找不到 AUTH_SECRET：请在 web/.env 里设置，或先在当前 shell 里 export AUTH_SECRET。\n' +
      '验收脚本必须与服务端使用同一个 AUTH_SECRET，否则 token 签得出、服务端验不过。'
  );
  process.exit(1);
}
process.env.AUTH_SECRET = secret;

const userId = Number(process.argv[2]);
if (!Number.isInteger(userId) || userId <= 0) {
  console.error('用法: npx tsx scripts/dev-token.ts <userId> [--cookie]');
  process.exit(1);
}

const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

// tsx 把本文件编成 cjs，顶层 await 不支持（报 "Top-level await is currently not supported
// with the cjs output format"），所以包一层 async main。
async function main() {
  // 动态 import：必须在 process.env.AUTH_SECRET 设好之后再加载 session 模块（见文件头第 1 点）
  const { signToken } = await import('../lib/auth/session');
  const token = await signToken({ user: { id: userId }, expires });
  process.stdout.write(process.argv.includes('--cookie') ? `session=${token}` : token);
}

void main();
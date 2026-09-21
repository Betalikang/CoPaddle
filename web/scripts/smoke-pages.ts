/**
 * S1-b 页面 smoke：mint 登录态后逐页请求，验证 SSR 路由与鉴权中间件。
 *
 * 前置：`docker compose up -d db` 且 `pnpm dev` 已在 :3000 运行。
 * 运行：pnpm tsx scripts/smoke-pages.ts
 *
 * 说明：页面外壳是 SSR（200 只证明路由/中间件/首屏渲染正常）；
 * 角色级数据拦截发生在客户端 SWR 请求上，由 scripts/smoke-s1.ts 覆盖。
 */
import { eq } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { courses, users } from '../lib/db/schema';
import { createCourse } from '../lib/services/courses';
import { signToken } from '../lib/auth/session';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const RUN = crypto.randomUUID().slice(0, 8);

let failures = 0;

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  × ${name} ${detail}`);
  }
}

async function mintSession(userId: number) {
  const token = await signToken({
    user: { id: userId },
    expires: new Date(Date.now() + 86400000).toISOString()
  });
  return `session=${token}`;
}

async function main() {
  console.log(`smoke-pages RUN=${RUN} BASE=${BASE}`);

  const [teacher] = await db
    .insert(users)
    .values({ email: `smoke-p-${RUN}@test.local`, passwordHash: 'x', name: '页面冒烟' })
    .returning();
  const cookie = await mintSession(teacher.id);

  // 未登录 → 重定向到 /sign-in
  const anon = await fetch(`${BASE}/dashboard`, { redirect: 'manual' });
  check('未登录访问 /dashboard 重定向', anon.status === 307, String(anon.status));

  // 课程工作台
  const home = await fetch(`${BASE}/dashboard`, { headers: { Cookie: cookie }, redirect: 'manual' });
  check('课程工作台 200', home.status === 200, String(home.status));

  // 建课向导
  const wizard = await fetch(`${BASE}/dashboard/courses/new`, { headers: { Cookie: cookie }, redirect: 'manual' });
  check('建课向导 200', wizard.status === 200, String(wizard.status));

  // 建一门课（走 service，与向导提交同一后端路径）
  const course = await createCourse({ name: `页面冒烟课程-${RUN}` }, teacher.id);

  for (const path of [
    `/dashboard/courses/${course.id}`,
    `/dashboard/courses/${course.id}/settings`,
    `/dashboard/courses/${course.id}/roster`,
    `/dashboard/courses/${course.id}/skill-card`,
    `/dashboard/courses/${course.id}/grouping`
  ]) {
    const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie }, redirect: 'manual' });
    check(`${path} 200`, res.status === 200, String(res.status));
  }

  // 不存在的课程：SSR 壳正常返回（错误态由客户端 SWR 渲染，见页面内 error 分支）
  const missing = await fetch(`${BASE}/dashboard/courses/99999999`, {
    headers: { Cookie: cookie },
    redirect: 'manual'
  });
  const missingText = await missing.text();
  check('不存在课程页面 200 且完整渲染', missing.status === 200 && missingText.includes('</html>'));

  // ---- 清理 ----
  await db.delete(courses).where(eq(courses.id, course.id));
  await db.delete(users).where(eq(users.id, teacher.id));

  console.log(failures === 0 ? 'PAGES SMOKE PASS' : `PAGES SMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke 脚本异常：', err);
  process.exit(1);
});

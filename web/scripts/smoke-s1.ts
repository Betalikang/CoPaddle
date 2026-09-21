/**
 * S1-a live smoke：用真实 HTTP 请求走通
 * 建课 → 名单 → 技能卡 → 切换上下文 → 权限负例。
 *
 * 前置：`docker compose up -d db` 且 `pnpm dev` 已在 :3000 运行。
 * 运行：pnpm tsx scripts/smoke-s1.ts
 * 结束后自动清理本轮创建的测试数据。
 */
import { and, eq, like, sql } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { courses, users } from '../lib/db/schema';
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

async function req(
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown } = {}
) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.cookie ? { Cookie: opts.cookie } : {}),
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {})
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json: json as any };
}

async function mintSession(userId: number) {
  const token = await signToken({
    user: { id: userId },
    expires: new Date(Date.now() + 86400000).toISOString()
  });
  return `session=${token}`;
}

async function main() {
  console.log(`smoke-s1 RUN=${RUN} BASE=${BASE}`);

  // 复用种子教师 test@test.com；另建一名冒烟教师避免污染种子数据
  const [teacher] = await db
    .insert(users)
    .values({
      email: `smoke-teacher-${RUN}@test.local`,
      passwordHash: 'x',
      name: '冒烟教师'
    })
    .returning();
  const teacherCookie = await mintSession(teacher.id);

  // 1) 未登录 401
  const noAuth = await req('GET', '/api/courses');
  check('未登录访问 /api/courses 返回 401', noAuth.status === 401);

  // 2) 建课
  const created = await req('POST', '/api/courses', {
    cookie: teacherCookie,
    body: { name: `冒烟课程-${RUN}`, code: 'SMOKE01' }
  });
  check('建课返回 201', created.status === 201, JSON.stringify(created.json));
  const courseId: number = created.json?.course?.id;
  check('返回课程 id', typeof courseId === 'number');

  // 3) 我的课程列表含角色
  const mine = await req('GET', '/api/me/courses', { cookie: teacherCookie });
  const found = mine.json?.courses?.find((c: any) => c.id === courseId);
  check('/api/me/courses 含新课且角色为 teacher', found?.myRole === 'teacher');

  // 4) 课程详情 + 默认设置
  const detail = await req('GET', `/api/courses/${courseId}`, { cookie: teacherCookie });
  check('课程详情 200 且含默认权重', detail.status === 200 && Number(detail.json?.settings?.wSkillCover) === 1.2);

  // 5) 非参与人 404
  const [outsider] = await db
    .insert(users)
    .values({ email: `smoke-outsider-${RUN}@test.local`, passwordHash: 'x' })
    .returning();
  const outsiderCookie = await mintSession(outsider.id);
  const denied = await req('GET', `/api/courses/${courseId}`, { cookie: outsiderCookie });
  check('非参与人访问课程返回 404', denied.status === 404);

  // 6) 非参与人改设置 403
  const deniedPatch = await req('PATCH', `/api/courses/${courseId}/settings`, {
    cookie: outsiderCookie,
    body: { groupCount: 4 }
  });
  check('非参与人改设置返回 403', deniedPatch.status === 403);

  // 7) 加入名单（单人）
  const enroll = await req('POST', `/api/courses/${courseId}/enrollments`, {
    cookie: teacherCookie,
    body: { email: `smoke-student-${RUN}@test.local`, name: '冒烟学生', studentNo: `2026${RUN}` }
  });
  check('单人加入名单 201', enroll.status === 201, JSON.stringify(enroll.json));

  // 8) CSV 导入（1 好 1 坏）
  const csv = [
    'name,email,student_no,class_name',
    `赵六,zhao-${RUN}@test.local,2026${RUN}06,冒烟班-1`,
    '钱七,bad-email,20260007,冒烟班-1'
  ].join('\n');
  const importRes = await req('POST', `/api/courses/${courseId}/enrollments/import`, {
    cookie: teacherCookie,
    body: { csv }
  });
  const report = importRes.json?.report;
  check(
    'CSV 导入报告 added=1 skipped=1',
    report?.added === 1 && report?.skipped === 1 && report?.errors?.length === 1,
    JSON.stringify(report)
  );

  // 9) 名单列表
  const list = await req('GET', `/api/courses/${courseId}/enrollments`, { cookie: teacherCookie });
  check('名单含 3 人（教师+2学生）', list.json?.enrollments?.length === 3, JSON.stringify(list.json));

  // 10) 技能卡提交与读回
  const cardPost = await req('POST', `/api/courses/${courseId}/skill-cards/me`, {
    cookie: teacherCookie,
    body: { skills: { 编程: 4, 写作: 3 } }
  });
  check('提交技能卡 201', cardPost.status === 201);
  const cardGet = await req('GET', `/api/courses/${courseId}/skill-cards/me`, { cookie: teacherCookie });
  check('读回技能卡一致', cardGet.json?.card?.skills?.['编程'] === 4);

  // 11) 技能卡参数校验（超范围 422/400）
  const badCard = await req('POST', `/api/courses/${courseId}/skill-cards/me`, {
    cookie: teacherCookie,
    body: { skills: { 编程: 9 } }
  });
  check('技能值超范围被拒', badCard.status === 400);

  // 12) 切换课程上下文
  const switchRes = await req('POST', '/api/me/switch-context', {
    cookie: teacherCookie,
    body: { courseId }
  });
  check('切换上下文返回 teacher 角色', switchRes.json?.role === 'teacher');

  // 13) 证据权重合计校验
  const badWeight = await req('PATCH', `/api/courses/${courseId}/settings`, {
    cookie: teacherCookie,
    body: { wArtifact: 0.9 }
  });
  check('证据权重合计≠1 被拒 400', badWeight.status === 400);

  // ---- 清理 ----
  await db.delete(courses).where(eq(courses.id, courseId));
  await db.delete(users).where(like(users.email, `%-${RUN}@test.local`));
  const leftover = await db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .where(like(users.email, `%-${RUN}@test.local`));
  check('清理后无残留', Number(leftover[0]?.n) === 0);

  console.log(failures === 0 ? 'SMOKE PASS' : `SMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke 脚本异常：', err);
  process.exit(1);
});

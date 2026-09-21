/**
 * S3 任务链路 smoke：分组落库 → LLM 拆解任务计划 → 依赖/指派/状态流转 →
 * 契约发布签署 → 我的部分。LLM 走真实 DeepSeek 调用。
 *
 * 前置：db + web dev(:3000) + algo(:8000) 运行，algo/.env 已配 LLM_API_KEY。
 * 运行：pnpm tsx scripts/smoke-tasks.ts
 */
import { eq, like } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { courses, users } from '../lib/db/schema';
import { createCourse } from '../lib/services/courses';
import { addEnrollment } from '../lib/services/enrollments';
import { upsertSkillCard } from '../lib/services/skill-cards';
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
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

const ASSIGNMENT = `小组作业：校园二手书交易平台设计。
要求：
1. 调研校内学生的二手书交易痛点（问卷或访谈，样本不少于 20 人）；
2. 设计平台的核心功能原型（至少 3 个页面）；
3. 撰写产品需求文档与商业模式一页纸；
4. 小组汇报 PPT（10 分钟）。
注意：文档中「交易成功率」必须统一定义并注明统计周期。`;

async function main() {
  console.log(`smoke-tasks RUN=${RUN} BASE=${BASE}`);

  const [teacher] = await db
    .insert(users)
    .values({ email: `smoke-t-${RUN}@test.local`, passwordHash: 'x', name: '任务冒烟教师' })
    .returning();
  const cookie = `session=${await signToken({
    user: { id: teacher.id },
    expires: new Date(Date.now() + 86400000).toISOString(),
  })}`;

  // 1) 建课 + 4 名学生 + 技能卡
  const course = await createCourse({ name: `任务冒烟课程-${RUN}` }, teacher.id);
  await req('PATCH', `/api/courses/${course.id}/settings`, {
    cookie,
    body: { groupCount: 1, minGroupSize: 4, maxGroupSize: 4 },
  });
  const dims = ['编程', '写作', '设计', '表达', '数据分析', '调研', '领导力'];
  const studentCookies: string[] = [];
  const studentIds: number[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await addEnrollment(course.id, {
      email: `stu${i}-${RUN}@test.local`,
      name: `学生${i + 1}`,
      studentNo: `2026${RUN}${i}`,
    });
    studentIds.push(r.userId);
    studentCookies.push(
      `session=${await signToken({ user: { id: r.userId }, expires: new Date(Date.now() + 86400000).toISOString() })}`
    );
    const skills: Record<string, number> = {};
    dims.forEach((d, j) => (skills[d] = (i + j) % 6));
    await upsertSkillCard(course.id, r.userId, { skills });
  }

  // 2) 分组求解 + 选定（4 人 1 组）
  const runRes = await req('POST', `/api/courses/${course.id}/grouping/run`, { cookie });
  check('分组求解 201', runRes.status === 201, JSON.stringify(runRes.json));
  const runData = await req('GET', `/api/grouping/runs/${runRes.json.runId}`, { cookie });
  const planId = runData.json.plans[0].id;
  const selectRes = await req('POST', `/api/grouping/plans/${planId}/select`, { cookie });
  check('选定方案落库', selectRes.json?.ok === true);
  const groupsRes = await req('GET', `/api/courses/${course.id}/groups`, { cookie });
  const groupId = groupsRes.json.groups[0].id;
  check('落库 1 个小组', groupsRes.json.groups.length === 1);

  // 3) LLM 拆解任务计划（真实 DeepSeek，最长 90s）
  console.log('  …调用 DeepSeek 拆解作业要求（最长 90s）…');
  const genRes = await req('POST', `/api/groups/${groupId}/task-plan/generate`, {
    cookie,
    body: { assignmentText: ASSIGNMENT, assignmentTitle: '校园二手书交易平台设计' },
  });
  check('拆解 201', genRes.status === 201, JSON.stringify(genRes.json).slice(0, 300));
  const problems: string[] = genRes.json?.problems ?? [];
  check('后置校验无问题', problems.length === 0, problems.join(';'));

  const planData = await req('GET', `/api/groups/${groupId}/task-plan`, { cookie });
  const tasks = planData.json.tasks ?? [];
  const deps = planData.json.deps ?? [];
  check('拆出任务', tasks.length >= 3, `实际 ${tasks.length}`);
  check('任务有依赖边', deps.length >= 1);
  check('任务有工时', tasks.every((t: any) => Number(t.estHours) > 0));

  // 4) 依赖环检测
  const t1 = tasks[0];
  const t2 = tasks[1];
  const dep1 = await req('POST', `/api/tasks/${t2.id}/deps`, { cookie, body: { dependsOnId: t1.id } });
  check('加依赖 ok', dep1.json?.ok === true);
  const cycle = await req('POST', `/api/tasks/${t1.id}/deps`, { cookie, body: { dependsOnId: t2.id } });
  check('成环被拒', cycle.json?.ok === false && cycle.json?.reason?.includes('环'), JSON.stringify(cycle.json));

  // 5) 指派（队长=教师代演）
  const assignRes = await req('POST', `/api/tasks/${t1.id}/assignees`, {
    cookie,
    body: { userId: studentIds[0], raci: 'lead' },
  });
  check('指派主责 201', assignRes.status === 201);

  // 6) 状态流转：非法 + 合法
  const badStatus = await req('POST', `/api/tasks/${t1.id}/status`, {
    cookie,
    body: { toStatus: 'done' }, // todo 不能直接 done
  });
  check('非法迁移被拒', badStatus.json?.ok === false && badStatus.json?.reason?.includes('不允许'));
  const okStatus = await req('POST', `/api/tasks/${t1.id}/status`, {
    cookie,
    body: { toStatus: 'doing', note: '开始调研' },
  });
  check('合法迁移 ok', okStatus.json?.ok === true);

  // 7) 队员只能改自己主责的任务（学生2 改学生1 的任务 → 403）
  const deniedStatus = await req('POST', `/api/tasks/${t1.id}/status`, {
    cookie: studentCookies[1],
    body: { toStatus: 'reviewing' },
  });
  check('非主责队员改状态 403', deniedStatus.status === 403);
  const ownStatus = await req('POST', `/api/tasks/${t1.id}/status`, {
    cookie: studentCookies[0],
    body: { toStatus: 'reviewing' },
  });
  check('主责队员改状态 ok', ownStatus.json?.ok === true);

  // 8) 「我的部分」
  const myTasks = await req('GET', '/api/me/tasks', { cookie: studentCookies[0] });
  check('我的部分含 1 个任务', myTasks.json?.tasks?.length === 1, JSON.stringify(myTasks.json).slice(0, 200));
  check('任务标注 RACI=lead', myTasks.json?.tasks?.[0]?.assignment?.raci === 'lead');

  // 9) 契约：LLM 生成 + 发布 + 签署
  const contractRes = await req('GET', `/api/groups/${groupId}/contract`, { cookie });
  const latest = contractRes.json?.latest;
  check('契约已生成', Boolean(latest), JSON.stringify(contractRes.json).slice(0, 200));
  check('术语表至少 2 条', (contractRes.json?.glossary?.length ?? 0) >= 2);
  const publishRes = await req('POST', `/api/groups/${groupId}/contract`, { cookie });
  check('发布契约 ok', publishRes.json?.contract?.publishedAt !== null);
  const acceptRes = await req('PUT', `/api/groups/${groupId}/contract`, {
    cookie: studentCookies[0],
    body: { contractId: latest.id },
  });
  check('成员签署 ok', acceptRes.json?.ok === true);

  // ---- 清理 ----
  await db.delete(courses).where(eq(courses.id, course.id));
  await db.delete(users).where(like(users.email, `%-${RUN}@test.local`));

  console.log(failures === 0 ? 'TASKS SMOKE PASS' : `TASKS SMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke 脚本异常：', err);
  process.exit(1);
});

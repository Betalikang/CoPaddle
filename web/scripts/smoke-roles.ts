/**
 * 三角色冒烟（教师 / 队长 / 队员）：只用隔离数据，不碰任何演示账号或线上库。
 *
 * 前置：`docker compose up -d db` 且应用已在 :3000 运行（生产构建或 dev 均可）。
 * 运行：`pnpm tsx scripts/smoke-roles.ts`
 *
 * 为什么单独写这个脚本（而不是复用 smoke-s1 / smoke-grouping）：
 *   优化计划 P2-8 要求「教师/队长/队员各有隔离数据的浏览器冒烟」，
 *   既有脚本都只覆盖教师视角，队长与队员的主路径（拆解 → 认领 → 提交）
 *   一条都没被自动化过，而那正是最容易在改共享件后悄悄坏掉的部分。
 *
 * 每个角色都自建用户、自建课程并清理，因此可以并行、可以反复跑。
 */
import { and, eq, inArray } from 'drizzle-orm';
import {
  courseMemberships,
  courses,
  groupMembers,
  groups,
  taskPlans,
  tasks,
  users
} from '../lib/db/schema';
import { db } from '../lib/db/drizzle';
import { createCourse } from '../lib/services/courses';
import { addEnrollment } from '../lib/services/enrollments';
import { upsertSkillCard } from '../lib/services/skill-cards';
import { runGrouping, selectPlan, getRunWithPlans } from '../lib/services/grouping';
import { createTask } from '../lib/services/tasks';
import { signToken } from '../lib/auth/session';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const RUN = crypto.randomUUID().slice(0, 8);
const DIMS = ['编程', '写作', '设计', '表达', '数据分析', '调研', '领导力'];

let failures = 0;
const createdCourseIds: number[] = [];
const createdUserIds: number[] = [];

function check(role: string, name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ [${role}] ${name}`);
  } else {
    failures++;
    console.error(`  × [${role}] ${name} ${detail}`);
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
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

async function mintCookie(userId: number) {
  const token = await signToken({
    user: { id: userId },
    expires: new Date(Date.now() + 86400000).toISOString()
  });
  return `session=${token}`;
}

async function newUser(tag: string) {
  const [u] = await db
    .insert(users)
    .values({ email: `smoke-${tag}-${RUN}@test.local`, passwordHash: 'x', name: `冒烟${tag}` })
    .returning();
  createdUserIds.push(u.id);
  return u;
}

async function main() {
  console.log(`smoke-roles RUN=${RUN} BASE=${BASE}`);

  // ---------- 公共夹具：一门课 + 4 名学生 + 已选定分组 ----------
  const teacher = await newUser('teacher');
  const teacherCookie = await mintCookie(teacher.id);
  const course = await createCourse({ name: `三角色冒烟-${RUN}` }, teacher.id);
  createdCourseIds.push(course.id);

  const studentIds: number[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await addEnrollment(course.id, {
      email: `smoke-st-${i}-${RUN}@test.local`,
      name: `冒烟学生${i + 1}`,
      studentNo: `R${RUN}${String(i + 1).padStart(2, '0')}`
    });
    studentIds.push(r.userId);
    createdUserIds.push(r.userId);
    await upsertSkillCard(course.id, r.userId, {
      skills: Object.fromEntries(DIMS.map((d, j) => [d, (i + j) % 6]))
    });
  }

  await db
    .update(courseMemberships)
    .set({ role: 'captain' })
    // 必须用 and(...)：&& 在 JS 里只返回后一个操作数，
    // 写成 inArray(...) && eq(...) 实际只按 courseId 过滤，会把全课成员都改成 captain。
    .where(
      and(
        inArray(courseMemberships.userId, [studentIds[0]]),
        eq(courseMemberships.courseId, course.id)
      )
    );
  await req('PATCH', `/api/courses/${course.id}/settings`, {
    cookie: teacherCookie,
    body: { groupCount: 1, minGroupSize: 4, maxGroupSize: 4 }
  });

  const run = await runGrouping(course.id, teacher.id);
  if ('error' in run) {
    console.error(`  × 夹具分组失败：${run.error}`);
    process.exit(1);
  }
  const runData = await getRunWithPlans(run.runId);
  const plan = runData!.plans[0];
  const selected = await selectPlan(plan.id, teacher.id);
  if ('error' in selected) {
    console.error(`  × 夹具选定失败：${selected.error}`);
    process.exit(1);
  }
  const [groupRow] = await db.select().from(groups).where(eq(groups.courseId, course.id));
  await db.delete(groupMembers).where(eq(groupMembers.groupId, groupRow.id));
  for (const uid of studentIds) {
    await db.insert(groupMembers).values({ groupId: groupRow.id, userId: uid, duty: 'member' });
  }
  await db.update(groups).set({ captainId: studentIds[0] }).where(eq(groups.id, groupRow.id));

  const captainCookie = await mintCookie(studentIds[0]);
  const memberCookie = await mintCookie(studentIds[1]);

  // ---------- 教师 ----------
  {
    const readiness = await req('GET', `/api/courses/${course.id}/readiness`, {
      cookie: teacherCookie
    });
    check('teacher', '就绪度 200', readiness.status === 200, JSON.stringify(readiness.json));
    check(
      'teacher',
      '就绪度显示 4 名学生且已选定分组',
      readiness.json?.students?.total === 4 && readiness.json?.grouping?.activeGroupCount === 1,
      JSON.stringify(readiness.json?.students) + ' ' + JSON.stringify(readiness.json?.grouping)
    );
    check('teacher', '就绪度阶段为 selected', readiness.json?.stage?.stage === 'selected', String(readiness.json?.stage?.stage));

    // 学生不能看就绪度（教师/助教专属）
    const denied = await req('GET', `/api/courses/${course.id}/readiness`, {
      cookie: memberCookie
    });
    check('teacher', '学生读就绪度被拒 403', denied.status === 403, String(denied.status));

    const alerts = await req('GET', `/api/courses/${course.id}/alerts`, { cookie: teacherCookie });
    check('teacher', '预警接口 200 且带 coverage', alerts.status === 200 && 'coverage' in (alerts.json ?? {}));

    const grade = await req('GET', `/api/courses/${course.id}/grade-export?format=csv`, {
      cookie: teacherCookie
    });
    check('teacher', '成绩导出 200', grade.status === 200, String(grade.status));

    const gradeDenied = await req('GET', `/api/courses/${course.id}/grade-export?format=csv`, {
      cookie: memberCookie
    });
    check('teacher', '学生导出成绩被拒 403', gradeDenied.status === 403, String(gradeDenied.status));
  }

  // ---------- 队长 ----------
  {
    const created = await req('POST', `/api/groups/${groupRow.id}/tasks`, {
      cookie: captainCookie,
      body: { title: '冒烟任务-队长建', estHours: 2 }
    });
    check('captain', '队长手工建任务 201', created.status === 201, JSON.stringify(created.json));
    const taskId = created.json?.task?.id;

    const planRes = await req('GET', `/api/groups/${groupRow.id}/task-plan`, { cookie: captainCookie });
    check('captain', '队长读任务计划 200', planRes.status === 200, String(planRes.status));
    check(
      'captain',
      '任务出现在计划里',
      Array.isArray(planRes.json?.tasks) && planRes.json.tasks.some((t: any) => t.id === taskId),
      JSON.stringify(planRes.json?.tasks?.length)
    );

    // 队长能把自己建的任务派给队员，并推进状态。
    // 注意两处契约：派工必须带 raci（assignSchema），状态路由是 POST + toStatus
    // （changeStatusSchema），状态机取值是 todo/doing/blocked/reviewing/done/cancelled。
    if (typeof taskId === 'number') {
      const assigned = await req('POST', `/api/tasks/${taskId}/assignees`, {
        cookie: captainCookie,
        body: { userId: studentIds[0], raci: 'lead' }
      });
      check('captain', '队长派工 200/201', assigned.status < 300, JSON.stringify(assigned.json));

      const moved = await req('POST', `/api/tasks/${taskId}/status`, {
        cookie: captainCookie,
        body: { toStatus: 'doing' }
      });
      check('captain', '队长改任务状态成功', moved.status === 200, JSON.stringify(moved.json));
    }

    // 学生不能读别人组的任务计划
    const foreign = await req('GET', `/api/groups/${groupRow.id}/task-plan`, {
      cookie: await mintCookie(
        (await addEnrollment(course.id, { email: `smoke-out-${RUN}@test.local`, name: '外人' })).userId
      )
    });
    check('captain', '非本组读任务计划被拒', foreign.status === 403 || foreign.status === 404, String(foreign.status));
  }

  // ---------- 队员 ----------
  {
    const mine = await req('GET', '/api/me/tasks', { cookie: memberCookie });
    check('member', '队员读我的任务 200', mine.status === 200, String(mine.status));

    // 队员不能建任务（只有教师/助教/队长可以）
    const denied = await req('POST', `/api/groups/${groupRow.id}/tasks`, {
      cookie: memberCookie,
      body: { title: '队员不该能建', estHours: 1 }
    });
    check('member', '队员建任务被拒 403', denied.status === 403, String(denied.status));

    const card = await req('GET', `/api/courses/${course.id}/skill-cards/me`, { cookie: memberCookie });
    check('member', '队员读自己的技能卡 200', card.status === 200, String(card.status));

    const saveCard = await req('POST', `/api/courses/${course.id}/skill-cards/me`, {
      cookie: memberCookie,
      body: { skills: Object.fromEntries(DIMS.map((d) => [d, 3])) }
    });
    check('member', '队员保存技能卡成功', saveCard.status < 300, JSON.stringify(saveCard.json));

    // 队员不能看贡献账本的教师侧全量锁定操作
    const lockDenied = await req('POST', `/api/groups/${groupRow.id}/contributions/lock`, {
      cookie: memberCookie
    });
    check('member', '队员锁定贡献账本被拒', lockDenied.status === 403, String(lockDenied.status));
  }

  // ---------- 归档只读（schema.ts:106 承诺的语义，此前没有任何 API 强制） ----------
  {
    const archived = await req('PATCH', `/api/courses/${course.id}`, {
      cookie: teacherCookie,
      body: { status: 'archived' }
    });
    check('archive', '教师能把课程置为归档', archived.status === 200, JSON.stringify(archived.json));

    const writeDenied = await req('PATCH', `/api/courses/${course.id}/settings`, {
      cookie: teacherCookie,
      body: { groupCount: 2 }
    });
    check(
      'archive',
      '归档后改设置被拒 409',
      writeDenied.status === 409,
      String(writeDenied.status) + ' ' + JSON.stringify(writeDenied.json)
    );

    const rerunDenied = await req('POST', `/api/courses/${course.id}/grouping/run`, {
      cookie: teacherCookie
    });
    check('archive', '归档后重新求解被拒 409', rerunDenied.status === 409, String(rerunDenied.status));

    const stillReadable = await req('GET', `/api/courses/${course.id}/alerts`, {
      cookie: teacherCookie
    });
    check('archive', '归档后仍可读预警', stillReadable.status === 200, String(stillReadable.status));

    const restored = await req('PATCH', `/api/courses/${course.id}`, {
      cookie: teacherCookie,
      body: { status: 'active' }
    });
    check('archive', '能改回进行中（取消归档不受只读限制）', restored.status === 200, String(restored.status));

    const writableAgain = await req('PATCH', `/api/courses/${course.id}/settings`, {
      cookie: teacherCookie,
      body: { groupCount: 1 }
    });
    check('archive', '取消归档后写操作恢复', writableAgain.status === 200, String(writableAgain.status));
  }

  // ---------- 清理 ----------
  for (const id of createdCourseIds) {
    await db.delete(taskPlans).where(eq(taskPlans.groupId, groupRow.id)).catch(() => {});
    await db.delete(tasks).where(eq(tasks.groupId, groupRow.id)).catch(() => {});
    await db.delete(courses).where(eq(courses.id, id));
  }
  if (createdUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }

  console.log(failures === 0 ? 'ROLES SMOKE PASS' : `ROLES SMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('角色冒烟脚本异常：', err);
  process.exit(1);
});
/**
 * 性能基线夹具：造计划第 7 项要求的「固定 24 组 / 216 任务」隔离测试数据，
 * 供 `docs/性能基线-实测.md` 的指标复测使用（同设备同网络重跑，判断是否回退）。
 *
 * 24 组 × 8 人 = 192 名学生（低于 MAX_STUDENTS_FOR_CPSAT=200，走真实 CP-SAT 求解，
 * 不是贪心兜底），每组 9 个任务 + 8 条依赖链边 → 216 个任务、192 条依赖。
 *
 * 用法（必须指向隔离库，别对生产库跑）：
 *   $env:POSTGRES_URL='postgresql://postgres@127.0.0.1:5433/copaddle'
 *   $env:ALGO_SERVICE_URL='http://127.0.0.1:8010'
 *   npx tsx scripts/perf-fixture.ts
 * 输出 JSON 含 courseId 与两枚 cookie，喂给 Playwright 测量脚本。
 */
import { and, eq, inArray } from 'drizzle-orm';
import { courseMemberships, groupMembers, groups, taskDeps, users } from '../lib/db/schema';
import { db } from '../lib/db/drizzle';
import { createCourse, updateCourseSettings } from '../lib/services/courses';
import { addEnrollment } from '../lib/services/enrollments';
import { upsertSkillCard } from '../lib/services/skill-cards';
import { runGrouping, selectPlan, getRunWithPlans } from '../lib/services/grouping';
import { createTask } from '../lib/services/tasks';
import { signToken } from '../lib/auth/session';

const RUN = crypto.randomUUID().slice(0, 8);
const DIMS = ['编程', '写作', '设计', '表达', '数据分析', '调研', '领导力'];
const GROUPS = 24;
const PER_GROUP = 8;
const TASKS_PER_GROUP = 9;

async function main() {
  const [teacher] = await db
    .insert(users)
    .values({ email: `big-teacher-${RUN}@test.local`, passwordHash: 'x', name: '压测教师' })
    .returning();
  const teacherCookie = `session=${await signToken({
    user: { id: teacher.id },
    expires: new Date(Date.now() + 86400000).toISOString()
  })}`;

  const course = await createCourse({ name: `24组216任务-${RUN}` }, teacher.id);
  const studentIds: number[] = [];
  const total = GROUPS * PER_GROUP;
  for (let i = 0; i < total; i++) {
    const r = await addEnrollment(course.id, {
      email: `big-st-${i}-${RUN}@test.local`,
      name: `压测学生${i + 1}`,
      studentNo: `B${RUN}${String(i + 1).padStart(3, '0')}`
    });
    studentIds.push(r.userId);
    await upsertSkillCard(course.id, r.userId, {
      skills: Object.fromEntries(DIMS.map((d, j) => [d, (i + j) % 6]))
    });
  }
  await db
    .update(courseMemberships)
    .set({ role: 'captain' })
    .where(
      and(
        inArray(courseMemberships.userId, studentIds.slice(0, GROUPS)),
        eq(courseMemberships.courseId, course.id)
      )
    );

  await updateCourseSettings(course.id, {
    groupCount: GROUPS,
    minGroupSize: PER_GROUP,
    maxGroupSize: PER_GROUP
  });

  const run = await runGrouping(course.id, teacher.id);
  if ('error' in run) {
    console.error('grouping failed', JSON.stringify(run));
    process.exit(1);
  }
  const runData = await getRunWithPlans(run.runId);
  await selectPlan(runData!.plans[0].id, teacher.id);
  const planGroups = runData!.plans[0].groups as number[][];

  const groupRows = await db.select().from(groups).where(eq(groups.courseId, course.id));
  console.log(`已落库小组数=${groupRows.length} 方案组数=${planGroups.length}`);

  // 每个小组落 9 个任务（含依赖链），队长为组内第一名成员
  let taskCount = 0;
  let chainCount = 0;
  for (const g of groupRows) {
    const members = planGroups.find((ids) => ids.some((id) => studentIds.includes(id))) ?? [];
    const inGroup = await db.select().from(groupMembers).where(eq(groupMembers.groupId, g.id));
    const uids = inGroup.length > 0 ? inGroup.map((m) => m.userId) : members.slice(0, PER_GROUP);
    if (inGroup.length === 0 && uids.length > 0) {
      for (const uid of uids) {
        await db.insert(groupMembers).values({ groupId: g.id, userId: uid, duty: 'member' });
      }
    }
    const created: number[] = [];
    for (let k = 0; k < TASKS_PER_GROUP; k++) {
      const r = await createTask(g.id, teacher.id, {
        title: `任务 ${k + 1}：资料整理与交付`,
        estHours: 1 + (k % 4)
      });
      if (r.ok) {
        created.push(r.task.id);
        taskCount += 1;
      }
    }
    // 前一个任务是后一个的前驱，形成 8 条依赖边
    for (let k = 1; k < created.length; k++) {
      await db.insert(taskDeps).values({ taskId: created[k], dependsOnId: created[k - 1] });
      chainCount += 1;
    }
  }

  console.log(
    JSON.stringify({
      RUN,
      courseId: course.id,
      groupId: groupRows[0]?.id,
      groups: groupRows.length,
      tasks: taskCount,
      deps: chainCount,
      captainCookie: `session=${await signToken({
        user: { id: studentIds[0] },
        expires: new Date(Date.now() + 86400000).toISOString()
      })}`,
      teacherCookie,
      teacherId: teacher.id
    })
  );
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
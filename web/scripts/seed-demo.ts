/**
 * 演示数据构造（三端账号 + 完整课程链路）。
 *
 * 重复运行安全：先清理旧的 @copaddle.local 演示数据。
 * 前置：db + algo(:8000) 运行（任务拆解走真实 DeepSeek，约 5-10s）。
 * 运行：pnpm tsx scripts/seed-demo.ts
 *
 * 产出账号（密码均为 copaddle123）：
 *   教师 teacher@copaddle.local —— 课程教师，可见全部门入口
 *   队长 captain@copaddle.local —— 第 1 组队长（课程角色 captain + 组内 lead）
 *   队员 member@copaddle.local  —— 第 2 组普通队员
 */
import { eq, inArray, like } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import {
  courseMemberships,
  courseSettings,
  courses,
  groupMembers,
  groups,
  users
} from '../lib/db/schema';
import { hashPassword } from '../lib/auth/session';
import { createCourse } from '../lib/services/courses';
import { addEnrollment } from '../lib/services/enrollments';
import { upsertSkillCard } from '../lib/services/skill-cards';
import { createArtifact, saveVersion } from '../lib/services/artifacts';
import { computeGroupContributions } from '../lib/services/contributions';

const DEMO_PASSWORD = 'copaddle123';
const DOMAIN = '@copaddle.local';

const DIMS = ['编程', '写作', '设计', '表达', '数据分析', '调研', '领导力'];

// 12 名学生的能力画像（差异化，保证分组结果有区分度）
const STUDENT_PROFILES: { name: string; studentNo: string; skills: number[] }[] = [
  { name: '张明远', studentNo: '20260001', skills: [5, 3, 2, 3, 4, 3, 4] },
  { name: '李思涵', studentNo: '20260002', skills: [3, 5, 3, 4, 2, 4, 3] },
  { name: '王雨桐', studentNo: '20260003', skills: [2, 4, 5, 3, 3, 3, 2] },
  { name: '陈子豪', studentNo: '20260004', skills: [4, 2, 3, 3, 5, 2, 3] },
  { name: '赵欣怡', studentNo: '20260005', skills: [3, 4, 4, 4, 3, 5, 3] },
  { name: '刘浩宇', studentNo: '20260006', skills: [5, 2, 2, 2, 4, 2, 2] },
  { name: '孙嘉怡', studentNo: '20260007', skills: [2, 5, 3, 5, 2, 4, 4] },
  { name: '周子墨', studentNo: '20260008', skills: [4, 3, 4, 3, 4, 3, 3] },
  { name: '吴佳琪', studentNo: '20260009', skills: [3, 4, 5, 3, 3, 4, 2] },
  { name: '郑浩然', studentNo: '20260010', skills: [4, 3, 2, 3, 5, 3, 3] },
  { name: '林诗雨', studentNo: '20260011', skills: [2, 5, 4, 4, 2, 5, 3] },
  { name: '黄宇轩', studentNo: '20260012', skills: [5, 2, 3, 2, 4, 2, 3] }
];

const ASSIGNMENT = `小组作业：城市商圈客流量分析与选址建议。
要求：
1. 收集某商圈连续两周的客流量数据（可自定采集方式）；
2. 分析客流的时间分布规律（工作日/周末、高峰时段）；
3. 结合周边业态，给出一个新店选址建议；
4. 提交一份图文报告（含至少 3 张图表）与可复现的分析代码。
注意：报告中「客流量」必须统一定义并注明单位。`;

async function main() {
  console.log('== 清理旧演示数据 ==');
  const oldUsers = await db.select({ id: users.id }).from(users).where(like(users.email, `%${DOMAIN}`));
  const oldIds = oldUsers.map((u) => u.id);
  if (oldIds.length > 0) {
    const oldCourses = await db.select({ id: courses.id }).from(courses).where(inArray(courses.teacherId, oldIds));
    for (const c of oldCourses) {
      await db.delete(courses).where(eq(courses.id, c.id)); // 级联清分组/任务/交付物
    }
    await db.delete(users).where(inArray(users.id, oldIds));
  }
  console.log(`清理 ${oldIds.length} 个旧演示账号`);

  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // ---- 教师 ----
  const [teacher] = await db
    .insert(users)
    .values({ email: `teacher${DOMAIN}`, name: '王教授', passwordHash, role: 'member', studentNo: 'T001' })
    .returning();
  console.log(`教师账号：teacher${DOMAIN}`);

  // ---- 课程 ----
  const course = await createCourse({ name: '数据分析基础', code: 'DATA101', term: '2026-2027-1', description: '城市数据采集、分析与可视化综合训练' }, teacher.id);
  console.log(`课程：${course.name}（${course.code}）`);

  // ---- 12 名学生 ----
  const studentIds: number[] = [];
  for (const [i, s] of STUDENT_PROFILES.entries()) {
    const r = await addEnrollment(course.id, {
      email: `student${i + 1}${DOMAIN}`,
      name: s.name,
      studentNo: s.studentNo
    });
    studentIds.push(r.userId);
    // 激活账号（教师代建默认 invited，演示账号直接激活并设密码）
    await db.update(users).set({ passwordHash, status: 'active' }).where(eq(users.id, r.userId));
    const skills: Record<string, number> = {};
    DIMS.forEach((d, j) => (skills[d] = s.skills[j]));
    await upsertSkillCard(course.id, r.userId, { skills });
  }
  console.log(`导入 ${studentIds.length} 名学生并完成技能卡`);

  // ---- 分组：3 组 × 4 人 ----
  const { runGrouping, selectPlan } = await import('../lib/services/grouping');
  await db.update(courseSettings).set({ groupCount: 3, minGroupSize: 4, maxGroupSize: 4 }).where(eq(courseSettings.courseId, course.id));

  const run = await runGrouping(course.id, teacher.id);
  if ('error' in run) throw new Error(`分组失败：${run.error}`);
  const { getRunWithPlans } = await import('../lib/services/grouping');
  const runData = await getRunWithPlans(run.runId);
  const planA = runData!.plans[0];
  const selected = await selectPlan(planA.id, teacher.id);
  if ('error' in selected) throw new Error(`选定失败：${selected.error}`);
  console.log('分组完成：3 组 × 4 人，已选定方案 A');

  // ---- 指定三端账号角色 ----
  const groupRows = await db.select().from(groups).where(eq(groups.courseId, course.id)).orderBy(groups.id);

  const membersOf = (groupId: number) =>
    db.select({ userId: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, groupId));

  const g1 = await membersOf(groupRows[0].id);
  const g2 = await membersOf(groupRows[1].id);
  const captainUser = g1[0].userId;
  const memberUser = g2[0].userId;

  // 课程级角色：captain（规格书 S1：角色是课程级的）
  await db.update(courseMemberships).set({ role: 'captain' }).where(
    eq(courseMemberships.userId, captainUser)
  );
  // 小组级职责：lead
  await db.update(groupMembers).set({ duty: 'lead' }).where(
    eq(groupMembers.userId, captainUser)
  );
  // 队长/队员账号邮箱改名（登录用）
  await db.update(users).set({ email: `captain${DOMAIN}`, name: '张明远（队长）' }).where(eq(users.id, captainUser));
  await db.update(users).set({ email: `member${DOMAIN}`, name: '李思涵（队员）' }).where(eq(users.id, memberUser));
  // 小组队长字段
  await db.update(groups).set({ captainId: captainUser }).where(eq(groups.id, groupRows[0].id));
  console.log(`队长账号：captain${DOMAIN}（第 1 组）／队员账号：member${DOMAIN}（第 2 组）`);

  // ---- 任务计划（LLM 拆解，以队长身份）----
  const { generateTaskPlan } = await import('../lib/services/tasks');
  const gen = await generateTaskPlan(groupRows[0].id, captainUser, {
    assignmentText: ASSIGNMENT,
    assignmentTitle: '城市商圈客流量分析与选址建议'
  });
  if ('aiUnavailable' in gen) throw new Error(`AI 拆解失败：${gen.message}`);
  if ('needConfirm' in gen) throw new Error('意外：已有任务计划');
  console.log(`任务计划已生成：plan #${gen.planId}${gen.problems.length ? `（${gen.problems.length} 个待修正问题）` : ''}`);

  // ---- 交付物与贡献（第 1 组）----
  const artifact = await createArtifact(groupRows[0].id, captainUser, {
    title: '商圈客流分析报告',
    isFinalDeliverable: true
  });
  const long = (n: number) => '通过对商圈连续两周的客流数据采集与清洗，我们发现工作日早高峰呈现明显的通勤特征，客流量在八点到九点之间达到峰值，而周末则表现为休闲驱动的双峰形态。'.repeat(Math.ceil(n / 60)).slice(0, n);
  await saveVersion(artifact.id, captainUser, [
    { seq: 0, kind: 'heading', content: '一、调研背景与方法' },
    { seq: 1, kind: 'paragraph', content: long(300) }
  ]);
  const g1Members = await membersOf(groupRows[0].id);
  if (g1Members[1]) {
    await saveVersion(artifact.id, g1Members[1].userId, [
      { seq: 0, kind: 'heading', content: '一、调研背景与方法' },
      { seq: 1, kind: 'paragraph', content: long(300) },
      { seq: 2, kind: 'paragraph', content: long(150) }
    ]);
  }
  if (g1Members[2]) {
    await saveVersion(artifact.id, g1Members[2].userId, [
      { seq: 0, kind: 'heading', content: '一、调研背景与方法' },
      { seq: 1, kind: 'paragraph', content: long(300) + '（补充：口径统一为每小时进入人数）' },
      { seq: 2, kind: 'paragraph', content: long(150) },
      { seq: 3, kind: 'figure', content: '图 1：工作日 vs 周末客流分布对比' }
    ]);
  }
  console.log('交付物已创建（3 名成员分段撰写）');

  const contrib = await computeGroupContributions(groupRows[0].id);
  console.log(`贡献账本已生成：${contrib.snapshotCount} 人快照${contrib.peerMissing ? '（同伴证据缺席，区间已放宽）' : ''}`);

  console.log('\n===== 演示账号（密码均为 ' + DEMO_PASSWORD + '）=====');
  console.log(`教师：teacher${DOMAIN}`);
  console.log(`队长：captain${DOMAIN}`);
  console.log(`队员：member${DOMAIN}`);
  console.log('课程：数据分析基础（DATA101）· 3 组 × 4 人 · 任务 DAG + 交付物 + 账本就绪');
  process.exit(0);
}

main().catch((err) => {
  console.error('seed 失败：', err);
  process.exit(1);
});

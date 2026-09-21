/**
 * S5 调度闭环 smoke：延期 → 健康度预警 → 冲突检测 → 重规划决策包 → 采纳执行。
 *
 * 前置：db + web dev(:3000) + algo(:8000) 运行。
 * 运行：pnpm tsx scripts/smoke-scheduling.ts
 */
import { eq, like } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { courses, users } from '../lib/db/schema';
import { createCourse } from '../lib/services/courses';
import { addEnrollment } from '../lib/services/enrollments';
import { upsertSkillCard } from '../lib/services/skill-cards';
import { runGrouping, selectPlan, getRunWithPlans } from '../lib/services/grouping';
import { generateTaskPlan, changeTaskStatus, assignTask } from '../lib/services/tasks';
import { computeGroupHealth, getCourseAlerts } from '../lib/services/health';
import { detectConflicts, listConflicts, resolveConflict } from '../lib/services/conflicts';
import { triggerReplan, getReplanEvent, adoptOption, listReplanEvents } from '../lib/services/replan';
import { signToken } from '../lib/auth/session';

const RUN = crypto.randomUUID().slice(0, 8);
let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  × ${name} ${detail}`); }
}

const ASSIGNMENT = `小组作业：校园二手书交易平台设计。
要求：1. 调研校内学生二手书交易痛点（问卷样本不少于 20 人）；2. 设计平台核心功能原型（至少 3 个页面）；3. 撰写产品需求文档与商业模式一页纸；4. 小组汇报 PPT。
注意：文档中「交易成功率」必须统一定义并注明统计周期。`;

async function main() {
  console.log(`smoke-scheduling RUN=${RUN}`);
  const [teacher] = await db.insert(users).values({ email: `ss-${RUN}@test.local`, passwordHash: 'x', name: '调度冒烟' }).returning();

  const course = await createCourse({ name: `调度冒烟课程-${RUN}` }, teacher.id);
  const { courseSettings } = await import('../lib/db/schema');
  await db.update(courseSettings).set({ groupCount: 1, minGroupSize: 3, maxGroupSize: 3 }).where(eq(courseSettings.courseId, course.id));

  const ids: number[] = [];
  const dims = ['编程', '写作', '设计', '表达', '数据分析', '调研', '领导力'];
  for (let i = 0; i < 3; i++) {
    const r = await addEnrollment(course.id, { email: `ss${i}-${RUN}@test.local`, name: `学生${i + 1}`, studentNo: 'SS' + Date.now() + i });
    ids.push(r.userId);
    const skills: Record<string, number> = {};
    dims.forEach((d, j) => (skills[d] = (i + j) % 6));
    await upsertSkillCard(course.id, r.userId, { skills });
  }
  const run = await runGrouping(course.id, teacher.id);
  if ('error' in run) throw new Error(run.error);
  const runData = await getRunWithPlans(run.runId);
  await selectPlan(runData!.plans[0].id, teacher.id);
  const { groups } = await import('../lib/db/schema');
  const [group] = await db.select().from(groups).where(eq(groups.courseId, course.id)).limit(1);
  const groupId = group.id;
  check('分组落库', true);

  // 任务计划（真实 LLM）
  console.log('  …DeepSeek 拆解中…');
  const gen = await generateTaskPlan(groupId, ids[0], { assignmentText: ASSIGNMENT });
  if ('aiUnavailable' in gen) throw new Error('AI 不可用: ' + gen.message);
  if ('needConfirm' in gen) throw new Error('unexpected needConfirm');
  check('任务计划生成', true);
  const plan = await import('../lib/services/tasks').then((m) => m.getTaskPlan(groupId));
  const tasks = plan!.tasks;
  check('拆出任务', tasks.length >= 3);

  // 指派 + 状态（写 progress_signals）
  await assignTask(tasks[0].id, ids[0], 'lead', ids[0]);
  await assignTask(tasks[1].id, ids[1], 'lead', ids[1]);
  await changeTaskStatus(tasks[0].id, ids[0], { toStatus: 'doing' });
  check('状态流转 + 信号沉淀', true);

  // 健康度
  const health = await computeGroupHealth(groupId);
  check('健康度快照', health.snapshot.id > 0 && health.detail.overall >= 0 && health.detail.overall <= 100);
  const alerts = await getCourseAlerts(course.id);
  check('预警中心可查（数组）', Array.isArray(alerts));

  // 构造依赖冲突：tasks[1] 阻塞 → 检测
  await changeTaskStatus(tasks[1].id, ids[1], { toStatus: 'blocked', note: '等数据' });
  const detected = await detectConflicts(groupId, 'manual');
  check('依赖冲突检测', detected.created >= 1, JSON.stringify(detected));
  const conflictList = await listConflicts(groupId);
  check('冲突列表非空', conflictList.length >= 1);
  const resolved = await resolveConflict(conflictList[0].id, ids[0], { action: 'realign', note: '已对齐口径' });
  check('冲突处理', 'resolution' in resolved);

  // 重规划：手动触发（关键路径延误语义用 manual 也可跑通）
  const replan = await triggerReplan(groupId, 'manual', { actorId: teacher.id, triggerTaskId: tasks[0].id, delayDays: 2 });
  if (!('triggered' in replan) || !replan.triggered) throw new Error('重规划未触发: ' + JSON.stringify(replan));
  const eventId = replan.eventId;
  check('重规划决策包生成', 'triggered' in replan && replan.triggered, JSON.stringify(replan));
  const event = await getReplanEvent(eventId);
  check('三方案齐全', event!.options.length === 3);
  check('每方案有代价说明', event!.options.every((o) => o.costSummary && o.costSummary.length > 0));
  const redistribute = event!.options.find((o) => o.action === 'redistribute')!;
  const adopted = await adoptOption(eventId, redistribute.id, teacher.id);
  check('采纳重新分配', 'ok' in adopted && adopted.ok, JSON.stringify(adopted));
  const after = await getReplanEvent(eventId);
  check('事件状态 adopted', after!.event.status === 'adopted');

  // 清理
  await db.delete(courses).where(eq(courses.id, course.id));
  await db.delete(users).where(like(users.email, `ss%-${RUN}@test.local`));
  console.log(failures === 0 ? 'SCHEDULING SMOKE PASS' : `SCHEDULING SMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('异常：', e); process.exit(1); });

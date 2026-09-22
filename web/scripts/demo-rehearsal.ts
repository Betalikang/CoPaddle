/**
 * S9.7 六步演示脚本彩排：按规格书脚本逐步走查，全程计时。
 * 目标：验证「答辩现场 5 分 30 秒不掉链子」。
 *
 * 前置：db + web dev(:3000) + algo(:8000，配 LLM key）。
 * 运行：pnpm tsx scripts/demo-rehearsal.ts
 */
import { eq, inArray, like } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { auditLogs, courses, courseSettings, groups, tasks, users } from '../lib/db/schema';
import { createCourse } from '../lib/services/courses';
import { addEnrollment } from '../lib/services/enrollments';
import { upsertSkillCard } from '../lib/services/skill-cards';
import { runGrouping, selectPlan, getRunWithPlans, previewMove, applyMove, resetPlan } from '../lib/services/grouping';
import { generateTaskPlan, markCriticalPath, assignTask, changeTaskStatus, getTaskPlan, getMyTasks } from '../lib/services/tasks';
import { createArtifact, saveVersion, compileFinal } from '../lib/services/artifacts';
import { computeGroupHealth, getCourseAlerts } from '../lib/services/health';
import { detectConflicts } from '../lib/services/conflicts';
import { triggerReplan, getReplanEvent, adoptOption } from '../lib/services/replan';
import { computeGroupContributions, getGroupLedger, getSnapshotEvidence, reviewSnapshot } from '../lib/services/contributions';
import { signToken } from '../lib/auth/session';

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const RUN = crypto.randomUUID().slice(0, 8);
const timings: { step: string; ms: number }[] = [];
let failures = 0;

function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`    ✓ ${name}`);
  else { failures++; console.error(`    × ${name} ${detail}`); }
}

async function step(name: string, fn: () => Promise<void>, budgetMs: number) {
  const t0 = Date.now();
  console.log(`\n[${name}]（预算 ${(budgetMs / 1000).toFixed(0)}s）`);
  await fn();
  const ms = Date.now() - t0;
  timings.push({ step: name, ms });
  console.log(`  [${ms <= budgetMs ? '✓' : '⚠ 超时'}] 本步耗时 ${(ms / 1000).toFixed(1)}s`);
}

const ASSIGNMENT = `小组作业：城市商圈客流量分析与选址建议。
要求：1. 收集某商圈连续两周的客流量数据（可自定采集方式）；2. 分析客流的时间分布规律（工作日/周末、高峰时段）；3. 结合周边业态，给出一个新店选址建议；4. 提交一份图文报告（含至少 3 张图表）与可复现的分析代码。
注意：报告中「客流量」必须统一定义并注明统计周期。`;

let courseId = 0;
let teacherId = 0;
let captainId = 0;
let memberId = 0;
let groupId = 0;

async function req(method: string, path: string, cookie: string, body?: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Cookie: cookie, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  try { return { status: res.status, json: JSON.parse(text) }; } catch { return { status: res.status, json: text }; }
}

async function main() {
  console.log(`demo-rehearsal RUN=${RUN}`);
  const [teacher] = await db.insert(users).values({ email: `dr-${RUN}@test.local`, passwordHash: 'x', name: '彩排教师' }).returning();
  teacherId = teacher.id;
  const cookie = `session=${await signToken({ user: { id: teacher.id }, expires: new Date(Date.now() + 86400000).toISOString() })}`;
  const course = await createCourse({ name: '答辩彩排课程', code: 'DEMO' }, teacher.id);
  courseId = course.id;
  await db.update(courseSettings).set({ groupCount: 2, minGroupSize: 3, maxGroupSize: 3 }).where(eq(courseSettings.courseId, course.id));

  // ============ 01 教师登录与名单（20s） ============
  await step('01 教师登录与名单', async () => {
    const me = await req('GET', '/api/auth/me', cookie);
    check('登录态正常', me.status === 200 && me.json?.user?.id === teacher.id);

    const dims = ['编程', '写作', '设计', '表达', '数据分析', '调研', '领导力'];
    for (let i = 0; i < 6; i++) {
      const r = await addEnrollment(course.id, { email: `dr${i}-${RUN}@test.local`, name: `学生${i + 1}`, studentNo: 'DR' + Date.now() + i });
      if (i === 0) captainId = r.userId;
      if (i === 3) memberId = r.userId;
      const skills: Record<string, number> = {};
      dims.forEach((d, j) => (skills[d] = (i + j) % 6));
      await upsertSkillCard(course.id, r.userId, { skills });
    }
    const roster = await req('GET', `/api/courses/${course.id}/enrollments`, cookie);
    check('名单含 6 名学生（+教师共 7 条）', (roster.json?.enrollments?.length ?? 0) === 7);
    const cardProgress = await req('GET', `/api/courses/${course.id}/skill-cards`, cookie);
    check('技能卡填写率 6/7（教师不填）', cardProgress.json?.filled === 6 && cardProgress.json?.total === 7);
  }, 20000);

  // ============ 02 分组工作台（90s） ============
  let planId = 0;
  await step('02 分组工作台：三方案/拖动/超员/选定', async () => {
    const t0 = Date.now();
    const run = await runGrouping(course.id, teacher.id);
    if ('error' in run) throw new Error(run.error);
    const runData = await getRunWithPlans(run.runId);
    check('求解 ≤10s', Date.now() - t0 <= 10000, `${Date.now() - t0}ms`);
    check('三套方案', runData!.plans.length === 3);
    check('每套四维得分+总分', runData!.plans.every((p) => Number(p.totalScore) > 0));

    planId = runData!.plans[0].id;
    const groups0 = runData!.plans[0].groups as number[][];
    const mover = groups0[0][0];
    const t1 = Date.now();
    const preview = await previewMove(planId, { userId: mover, fromGroup: 0, toGroup: 1 });
    check('preview-move ≤50ms', Date.now() - t1 <= 50, `${Date.now() - t1}ms`);
    check('预演返回四维 deltas', typeof preview.deltas.skill_cover === 'number' && typeof preview.deltas.total === 'number');

    const denied = await applyMove(planId, { userId: mover, fromGroup: 0, toGroup: 1 });
    check('破坏规模约束被拒绝且给原因', !denied.ok && denied.violations.length > 0, JSON.stringify(denied).slice(0, 120));

    const a = groups0[0][0];
    const b = groups0[1][0];
    const swapped = await applyMove(planId, { userA: a, userB: b });
    check('互换成功', swapped.ok);
    await resetPlan(planId);
    const after = await getRunWithPlans(run.runId);
    check('还原到求解器原始结果', JSON.stringify(after!.plans[0].groups) === JSON.stringify(groups0));

    const sel = await selectPlan(planId, teacher.id);
    check('选定方案 A 落库', 'ok' in sel && sel.ok);
  }, 90000);

  const [g] = await db.select().from(groups).where(eq(groups.courseId, course.id)).limit(1);
  groupId = g.id;

  // ============ 03 作业拆解（60s） ============
  await step('03 作业拆解：DAG + 契约 + 关键路径', async () => {
    const t0 = Date.now();
    const gen = await generateTaskPlan(groupId, captainId, { assignmentText: ASSIGNMENT, assignmentTitle: '城市商圈客流量分析与选址建议' });
    check('LLM 拆解 ≤60s', Date.now() - t0 <= 60000, `${Date.now() - t0}ms`);
    if ('aiUnavailable' in gen) throw new Error('AI 不可用');
    if ('needConfirm' in gen) throw new Error('意外重复');
    check('后置校验无问题', gen.problems.length === 0, gen.problems.join(';'));

    const plan = await getTaskPlan(groupId);
    check('任务 ≥3 且带依赖', plan!.tasks.length >= 3 && plan!.deps.length >= 1);

    const cp = await markCriticalPath(groupId);
    check('关键路径非空', cp.path.length >= 2, JSON.stringify(cp));
    const cpRows = await db.select().from(tasks).where(eq(tasks.groupId, groupId));
    check('关键路径已标记（加粗）', cpRows.some((t) => t.onCriticalPath));
  }, 60000);

  // ============ 04 我的部分 + 编辑器（40s） ============
  await step('04 队员端：我的部分 + 交付物编辑器', async () => {
    const plan = await getTaskPlan(groupId);
    const t0 = plan!.tasks[0];
    await assignTask(t0.id, memberId, 'lead', captainId);
    const mine = await getMyTasks(memberId);
    check('我的部分含 1 任务', mine.length === 1);
    check('三问要素：标题/截止/RACI', mine[0].task.title.length > 0 && mine[0].assignment.raci === 'lead');

    const art = await createArtifact(groupId, memberId, { title: '答辩彩排报告', isFinalDeliverable: true });
    const saved = await saveVersion(art.id, memberId, [
      { seq: 0, kind: 'heading', content: '一、调研背景' },
      { seq: 1, kind: 'paragraph', content: '通过对商圈连续两周的客流数据采集与清洗，我们发现工作日早高峰呈现明显的通勤特征。'.repeat(20) }
    ]);
    check('编辑器保存（diff 反馈）', saved.diffSummary.includes('新增 2'), saved.diffSummary);
  }, 40000);

  // ============ 05 延期 → 预警 → 重规划（50s） ============
  await step('05 延期 → 健康度 → 冲突 → 重规划采纳', async () => {
    const cpTask = (await db.select().from(tasks).where(eq(tasks.groupId, groupId))).find((t) => t.onCriticalPath)!;
    await changeTaskStatus(cpTask.id, captainId, { toStatus: 'blocked', note: '数据未到' });

    const health = await computeGroupHealth(groupId);
    check('健康度快照生成', health.snapshot.id > 0);
    check('阻塞分下降', Number(health.snapshot.blockedScore) < 100);
    const alerts = await getCourseAlerts(course.id);
    check('预警中心有条目', alerts.length >= 1);

    const detected = await detectConflicts(groupId, 'manual');
    check('依赖冲突自动生成', detected.created >= 1);

    const replan = await triggerReplan(groupId, 'manual', { actorId: teacher.id, triggerTaskId: cpTask.id, delayDays: 2 });
    if (!('triggered' in replan) || !replan.triggered) throw new Error('重规划未触发');
    const ev = await getReplanEvent(replan.eventId);
    check('三方案 + 代价说明', ev!.options.length === 3 && ev!.options.every((o) => (o.costSummary ?? '').length > 0));
    const redist = ev!.options.find((o) => o.action === 'redistribute')!;
    const adopted = await adoptOption(replan.eventId, redist.id, teacher.id);
    check('采纳重新分配', 'ok' in adopted && adopted.ok);
  }, 50000);

  // ============ 06 贡献账本 + 终审（70s） ============
  await step('06 贡献账本：构成/区间/下钻/终审', async () => {
    const plan = await getTaskPlan(groupId);
    const other = plan!.tasks[1];
    await assignTask(other.id, captainId, 'lead', captainId);
    await compileFinal(groupId, captainId);

    const contrib = await computeGroupContributions(groupId);
    check('归因计算', contrib.snapshotCount >= 2);

    const ledger = await getGroupLedger(groupId);
    check('账本条目', ledger!.entries.length >= 2);
    // 挑有产出物证据的成员验证下钻（写段落的人）
    const e0 = ledger!.entries.find((e) => (e.comp?.['主责产出'] ?? 0) > 0) ?? ledger!.entries[0];
    check('存在有产出证据的成员', (e0.comp?.['主责产出'] ?? 0) > 0, JSON.stringify(ledger!.entries.map((e) => e.comp)));
    check('区间无单一分数', e0.low <= e0.high && e0.high - e0.low <= 8);
    check('贡献构成非空', Object.keys(e0.comp ?? {}).length > 0);

    const ev = await getSnapshotEvidence(e0.snapshotId);
    check('证据可下钻（段落原文）', (ev?.items.length ?? 0) >= 1 && ev!.items.some((i) => i.segment));

    const review = await reviewSnapshot(e0.snapshotId, teacher.id, { adjustedLow: 40, adjustedHigh: 50, finalNote: '答辩彩排终审' });
    check('教师终审生效', review.adjustedLow === '40.00' || review.adjustedLow === '40');
  }, 70000);

  // ============ 汇总 ============
  const total = timings.reduce((s, t) => s + t.ms, 0);
  console.log('\n========== 彩排汇总 ==========');
  for (const t of timings) {
    console.log(`  ${t.step}: ${(t.ms / 1000).toFixed(1)}s`);
  }
  console.log(`  总计: ${(total / 1000).toFixed(1)}s（脚本预算 330s）`);

  // 清理
  await db.delete(courses).where(eq(courses.id, course.id));
  const doomed = await db.select({ id: users.id }).from(users).where(like(users.email, `dr%-${RUN}@test.local`));
  if (doomed.length) await db.delete(auditLogs).where(inArray(auditLogs.actorId, doomed.map((d) => d.id)));
  await db.delete(users).where(like(users.email, `dr%-${RUN}@test.local`));

  console.log(failures === 0 ? 'REHEARSAL PASS' : `REHEARSAL FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('彩排异常：', e); process.exit(1); });

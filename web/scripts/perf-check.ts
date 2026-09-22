/**
 * S7.1 性能实测：对照规格书性能指标逐项计时。
 * 运行：pnpm tsx scripts/perf-check.ts（需要 algo 服务在跑）
 */
import { eq, like } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { courses, users } from '../lib/db/schema';
import { createCourse } from '../lib/services/courses';
import { addEnrollment } from '../lib/services/enrollments';
import { upsertSkillCard } from '../lib/services/skill-cards';
import { runGrouping, getRunWithPlans, previewMove, selectPlan } from '../lib/services/grouping';
import { generateTaskPlan, markCriticalPath, getTaskPlan } from '../lib/services/tasks';
import { computeGroupHealth } from '../lib/services/health';
import { computeGroupContributions } from '../lib/services/contributions';
import { signToken } from '../lib/auth/session';

const RUN = Math.random().toString(16).slice(2, 10);
const results: { name: string; ms: number; budget: string; ok: boolean }[] = [];

function measure(name: string, budget: string, budgetMs: number, ms: number) {
  results.push({ name, ms: Math.round(ms), budget, ok: ms <= budgetMs });
  console.log(`  ${ms <= budgetMs ? "✓" : "✗"} ${name}: ${Math.round(ms)}ms（要求 ${budget}）`);
}

const ASSIGNMENT = "小组作业：城市商圈客流量分析与选址建议。要求：1. 收集某商圈连续两周的客流量数据；2. 分析客流时间分布规律；3. 给出新店选址建议；4. 提交图文报告与可复现代码。注意：「客流量」必须统一定义并注明单位。";

async function main() {
  console.log(`perf-check RUN=${RUN}`);
  const [teacher] = await db.insert(users).values({ email: `pf-${RUN}@test.local`, passwordHash: "x", name: "性能" }).returning();
  const cookie = `session=${await signToken({ user: { id: teacher.id }, expires: new Date(Date.now() + 86400000).toISOString() })}`;
  const course = await createCourse({ name: "性能课程" }, teacher.id);
  const { courseSettings, groups } = await import("../lib/db/schema");
  await db.update(courseSettings).set({ groupCount: 8, minGroupSize: 3, maxGroupSize: 4 }).where(eq(courseSettings.courseId, course.id));

  // 30 人（演示规模）
  const dims = ["编程", "写作", "设计", "表达", "数据分析", "调研", "领导力"];
  for (let i = 0; i < 30; i++) {
    const r = await addEnrollment(course.id, { email: `pf${i}-${RUN}@test.local`, name: `学生${i}`, studentNo: "PF" + Date.now() + i });
    const skills: Record<string, number> = {};
    dims.forEach((d, j) => (skills[d] = (i + j) % 6));
    await upsertSkillCard(course.id, r.userId, { skills });
  }

  // 1) CP-SAT 求解 <= 10s
  const t0 = Date.now();
  const run = await runGrouping(course.id, teacher.id);
  if ("error" in run) throw new Error(run.error);
  measure("CP-SAT 分组求解（30 人 8 组）", "<= 10s", 10000, Date.now() - t0);

  const runData = await getRunWithPlans(run.runId);
  const planId = runData!.plans[0].id;
  const groups0 = runData!.plans[0].groups as number[][];
  const mover = groups0[0][0];

  // 2) preview-move <= 50ms（连测 5 次取最大）
  let maxPreview = 0;
  for (let i = 0; i < 5; i++) {
    const t = Date.now();
    await previewMove(planId, { userId: mover, fromGroup: 0, toGroup: 1 });
    maxPreview = Math.max(maxPreview, Date.now() - t);
  }
  measure("preview-move 拖动预演（5 次最大）", "<= 50ms", 50, maxPreview);

  await selectPlan(planId, teacher.id);
  const [g] = await db.select().from(groups).where(eq(groups.courseId, course.id)).limit(1);

  // 3) LLM 拆解 <= 60s（规格 S7.1）
  const t2 = Date.now();
  const gen = await generateTaskPlan(g.id, groups0[0][0], { assignmentText: ASSIGNMENT });
  if ("aiUnavailable" in gen) throw new Error("AI 不可用");
  measure("LLM 作业拆解", "<= 60s", 60000, Date.now() - t2);

  // 4) 关键路径 <= 200ms
  const t3 = Date.now();
  await markCriticalPath(g.id);
  measure("关键路径计算", "<= 200ms", 200, Date.now() - t3);

  // 5) 健康度计算 <= 2s
  const t4 = Date.now();
  await computeGroupHealth(g.id);
  measure("健康度三维计算", "<= 2s", 2000, Date.now() - t4);

  // 6) 贡献归因全组 <= 2s
  const t5 = Date.now();
  await computeGroupContributions(g.id);
  measure("贡献归因全组计算", "<= 2s", 2000, Date.now() - t5);

  // 7) 读接口 P95 <= 300ms（抽 3 个代表接口；先 warmup 排除 dev 编译开销）
  for (const [, path] of [
    ["warm", "/api/courses"],
    ["warm", `/api/courses/${course.id}/enrollments`],
    ["warm", `/api/groups/${g.id}/task-plan`],
  ] as const) {
    await fetch(`http://localhost:3000${path}`, { headers: { Cookie: cookie } }).then((r) => r.text());
  }
  for (const [name, path] of [
    ["GET /api/courses", "/api/courses"],
    ["GET /api/courses/:id/enrollments", `/api/courses/${course.id}/enrollments`],
    ["GET /api/groups/:id/task-plan", `/api/groups/${g.id}/task-plan`],
  ] as const) {
    const t = Date.now();
    const res = await fetch(`http://localhost:3000${path}`, { headers: { Cookie: cookie } });
    await res.text();
    measure(name, "<= 300ms", 300, Date.now() - t);
  }

  // 汇总
  console.log("\n===== 性能汇总 =====");
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`  ${r.ok ? "✓" : "✗"} ${r.name}: ${r.ms}ms / ${r.budget}`);
  }
  console.log(failed.length === 0 ? "PERF PASS" : `PERF FAIL（${failed.length} 项超标）`);

  // 清理
  await db.delete(courses).where(eq(courses.id, course.id));
  const { auditLogs } = await import("../lib/db/schema");
  const { inArray } = await import("drizzle-orm");
  const doomed = await db.select({ id: users.id }).from(users).where(like(users.email, `pf%-${RUN}@test.local`));
  if (doomed.length) await db.delete(auditLogs).where(inArray(auditLogs.actorId, doomed.map((d) => d.id)));
  await db.delete(users).where(like(users.email, `pf%-${RUN}@test.local`));
  process.exit(failed.length === 0 ? 0 : 1);
}
main().catch((e) => { console.error("性能脚本异常：", e); process.exit(1); });

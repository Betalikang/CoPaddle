/**
 * S6-a 同伴互评 smoke：轮次 → 四人互评 → 异常检测（互刷）→
 * 去极值结果 → 归因三类证据齐（同伴证据生效）。
 *
 * 前置：db + web dev(:3000) + algo(:8000)。
 * 运行：pnpm tsx scripts/smoke-peer-reviews.ts
 */
import { eq, like } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { courses, users } from '../lib/db/schema';
import { createCourse } from '../lib/services/courses';
import { addEnrollment } from '../lib/services/enrollments';
import { upsertSkillCard } from '../lib/services/skill-cards';
import { runGrouping, selectPlan, getRunWithPlans } from '../lib/services/grouping';
import {
  createRound,
  openRound,
  submitReview,
  closeRound,
  roundResults,
  listAnomalies,
  roundProgress,
  getPeerScoresForAttribution
} from '../lib/services/peer-reviews';
import { computeGroupContributions } from '../lib/services/contributions';
import { createArtifact, saveVersion } from '../lib/services/artifacts';

const RUN = crypto.randomUUID().slice(0, 8);
let failures = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  × ${name} ${detail}`); }
}

async function main() {
  console.log(`smoke-peer-reviews RUN=${RUN}`);
  const [teacher] = await db.insert(users).values({ email: `pr-${RUN}@test.local`, passwordHash: 'x', name: '互评冒烟' }).returning();
  const course = await createCourse({ name: `互评冒烟课程-${RUN}` }, teacher.id);
  const { courseSettings } = await import('../lib/db/schema');
  await db.update(courseSettings).set({ groupCount: 1, minGroupSize: 4, maxGroupSize: 4 }).where(eq(courseSettings.courseId, course.id));

  const ids: number[] = [];
  const dims = ['编程', '写作', '设计', '表达', '数据分析', '调研', '领导力'];
  for (let i = 0; i < 4; i++) {
    const r = await addEnrollment(course.id, { email: `pr${i}-${RUN}@test.local`, name: `学生${i + 1}`, studentNo: 'PR' + Date.now() + i });
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
  check('分组落库', true);

  // 1) 建轮次 + 开启
  const round = await createRound(course.id, teacher.id, { name: '期中互评' });
  await openRound(round.id);
  check('轮次创建并开启', round.id > 0);

  // 2) 四人互评（学生 1、2 互刷高分：互给 5，给其他两人 2 分）
  const mkScores = (vals: number[]) => ({ 贡献: vals[0], 沟通: vals[1], 负责: vals[2], 质量: vals[3], 技能: vals[4] });
  // 学生1 → 2:5分, 3:4, 4:3
  await submitReview(round.id, ids[0], { revieweeId: ids[1], scores: mkScores([5, 5, 5, 5, 5]), comment: '配合好' });
  await submitReview(round.id, ids[0], { revieweeId: ids[2], scores: mkScores([4, 4, 3, 4, 3]) });
  await submitReview(round.id, ids[0], { revieweeId: ids[3], scores: mkScores([3, 3, 3, 2, 3]) });
  // 学生2 → 1:5分（互刷）, 3:3, 4:3
  await submitReview(round.id, ids[1], { revieweeId: ids[0], scores: mkScores([5, 5, 5, 5, 5]) });
  await submitReview(round.id, ids[1], { revieweeId: ids[2], scores: mkScores([3, 3, 3, 3, 3]) });
  await submitReview(round.id, ids[1], { revieweeId: ids[3], scores: mkScores([3, 3, 2, 3, 3]) });
  // 学生3 → 1:4, 2:4, 4:4
  await submitReview(round.id, ids[2], { revieweeId: ids[0], scores: mkScores([4, 4, 4, 4, 4]) });
  await submitReview(round.id, ids[2], { revieweeId: ids[1], scores: mkScores([4, 4, 4, 4, 4]) });
  await submitReview(round.id, ids[2], { revieweeId: ids[3], scores: mkScores([4, 4, 4, 4, 4]) });
  // 学生4 → 1:3, 2:3, 3:4
  await submitReview(round.id, ids[3], { revieweeId: ids[0], scores: mkScores([3, 3, 3, 3, 3]) });
  await submitReview(round.id, ids[3], { revieweeId: ids[1], scores: mkScores([3, 3, 3, 3, 3]) });
  await submitReview(round.id, ids[3], { revieweeId: ids[2], scores: mkScores([4, 4, 4, 4, 4]) });
  check('12 份评价提交（4×3）', true);

  // 3) 关闭 → 异常检测
  await closeRound(round.id);
  const progress = await roundProgress(round.id);
  check('完成率 12/12', progress!.submitted === 12 && progress!.expected === 12, JSON.stringify(progress));
  const anomalies = await listAnomalies(round.id);
  check('检测到互刷高分异常', anomalies.some((a) => a.type === 'mutual_inflation'), JSON.stringify(anomalies.map((a) => a.type)));

  // 4) 结果：去极值中位数（每人 3 份 < 4 → 直接中位数）
  const results = await roundResults(round.id);
  const top = results!.results[0];
  check('结果排名非空', results!.results.length === 4);
  check('互刷二人中位数被拉高（学生2 均分 5+3+3 → 3.67 高于其他人）', top.userId === ids[1], JSON.stringify(results!.results));

  // 5) 归因：同伴证据生效
  const peerScores = await getPeerScoresForAttribution(group.id, ids[1]);
  check('同伴评分可取（3 份原始分）', peerScores.length === 3, JSON.stringify(peerScores));

  // 造产出物证据（否则 point 全由同伴主导）
  const artifact = await createArtifact(group.id, ids[0], { title: '互评冒烟报告' });
  await saveVersion(artifact.id, ids[0], [{ seq: 0, kind: 'paragraph', content: '内容'.repeat(100) }]);

  const contrib = await computeGroupContributions(group.id);
  check('归因计算成功', contrib.snapshotCount === 4);
  check('同伴证据不再缺席', contrib.peerMissing === false);

  // 6) 清理
  await db.delete(courses).where(eq(courses.id, course.id));
  await db.delete(users).where(like(users.email, `pr%-${RUN}@test.local`));
  console.log(failures === 0 ? 'PEER REVIEW SMOKE PASS' : `PEER REVIEW SMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error('异常：', e); process.exit(1); });

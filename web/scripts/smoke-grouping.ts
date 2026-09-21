/**
 * S2 分组链路 smoke：建课 → 名单 → 技能卡 → 求解三方案 →
 * 拖动预演（四维增减）→ 应用 → 还原 → 选定落库 → 小组列表。
 *
 * 前置：`docker compose up -d db`、`pnpm dev`（:3000）、algo（:8000）均在运行。
 * 运行：pnpm tsx scripts/smoke-grouping.ts
 */
import { eq, like, sql } from 'drizzle-orm';
import { db } from '../lib/db/drizzle';
import { courses, users } from '../lib/db/schema';
import { createCourse } from '../lib/services/courses';
import { addEnrollment, importEnrollmentsCsv } from '../lib/services/enrollments';
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

async function main() {
  console.log(`smoke-grouping RUN=${RUN} BASE=${BASE}`);

  const [teacher] = await db
    .insert(users)
    .values({ email: `smoke-g-${RUN}@test.local`, passwordHash: 'x', name: '分组冒烟' })
    .returning();
  const cookie = `session=${await signToken({
    user: { id: teacher.id },
    expires: new Date(Date.now() + 86400000).toISOString()
  })}`;

  // 1) 建课 + 调设置为 3 组 3-5 人（12 人必然分出 4 人组，覆盖移动预演）
  const course = await createCourse({ name: `分组冒烟课程-${RUN}` }, teacher.id);
  const settingsRes = await req('PATCH', `/api/courses/${course.id}/settings`, {
    cookie,
    body: { groupCount: 3, minGroupSize: 3, maxGroupSize: 5 }
  });
  check('课程设置 8→3 组', settingsRes.status === 200);

  // 2) 导入 12 名学生 + 填技能卡
  const csvLines = ['name,email,student_no,class_name'];
  const dims = ['编程', '写作', '设计', '表达', '数据分析', '调研', '领导力'];
  for (let i = 0; i < 12; i++) {
    csvLines.push(`学生${i + 1},s${i}-${RUN}@test.local,2026${RUN}${String(i + 1).padStart(2, '0')},冒烟班`);
  }
  const importRes = await req('POST', `/api/courses/${course.id}/enrollments/import`, {
    cookie,
    body: { csv: csvLines.join('\n') }
  });
  check('CSV 导入 12 人', importRes.json?.report?.added === 12, JSON.stringify(importRes.json?.report));

  // 给学生填技能卡（用 service 层，逐人差异化）
  const roster = await req('GET', `/api/courses/${course.id}/enrollments`, { cookie });
  for (const [i, e] of roster.json.enrollments.entries()) {
    const skills: Record<string, number> = {};
    dims.forEach((d, j) => {
      skills[d] = (i + j) % 6;
    });
    await upsertSkillCard(course.id, e.userId, { skills });
  }

  // 3) 触发求解
  const runRes = await req('POST', `/api/courses/${course.id}/grouping/run`, { cookie });
  check('触发分组求解 201', runRes.status === 201, JSON.stringify(runRes.json));
  const runId = runRes.json?.runId;
  check('返回 runId', typeof runId === 'number');

  // 4) 三方案 + 四维得分
  const runData = await req('GET', `/api/grouping/runs/${runId}`, { cookie });
  const plans = runData.json?.plans ?? [];
  check('返回三套方案', plans.length === 3);
  check('每套方案有分组与总分', plans.every((p: any) => p.groups.length === 3 && Number(p.totalScore) > 0));
  const allAssigned = plans[0]?.groups.flat().sort((a: number, b: number) => a - b) ?? [];
  check('方案全覆盖 12 人', allAssigned.length === 12);
  check('组规模在 3-5', plans[0].groups.every((g: number[]) => g.length >= 3 && g.length <= 5));

  // 5) 拖动预演（swap 不改变组规模，H1 天然满足；preview 不落库）
  const planId = plans[0].id;
  const userA = plans[0].groups[0][0];
  const userB = plans[0].groups[1][0];
  const preview = await req('POST', `/api/grouping/plans/${planId}/preview-move`, {
    cookie,
    body: { userId: userA, fromGroup: 0, toGroup: 0, swapWith: userB }
  });
  // preview-move 端点当前只支持移动语义；swap 走 swap 端点（下面 6b）。
  // 这里验证「移动」路径：从人数 > min 的组移到人数 < max 的组
  const srcIdx = plans[0].groups.findIndex((g: number[]) => g.length > 3);
  const dstIdx = plans[0].groups.findIndex((g: number[], i: number) => i !== srcIdx && g.length < 5);
  if (srcIdx >= 0 && dstIdx >= 0) {
    const mover = plans[0].groups[srcIdx][0];
    const movePreview = await req('POST', `/api/grouping/plans/${planId}/preview-move`, {
      cookie,
      body: { userId: mover, fromGroup: srcIdx, toGroup: dstIdx }
    });
    check('预演返回 ok', movePreview.status === 200 && movePreview.json?.ok === true, JSON.stringify(movePreview.json));
    check(
      '预演返回四维 deltas 与前后总分',
      typeof movePreview.json?.deltas?.total === 'number' &&
        typeof movePreview.json?.deltas?.skill_cover === 'number' &&
        typeof movePreview.json?.totalBefore === 'number'
    );
  } else {
    console.log('  - 无 4 人组可移动，跳过移动预演（swap 用例仍执行）');
  }

  // 6) 应用一次 swap：快照中两人位置互换
  const applied = await req('POST', `/api/grouping/plans/${planId}/swap`, {
    cookie,
    body: { userA, userB }
  });
  check('应用 swap 成功', applied.status === 200 && applied.json?.ok === true, JSON.stringify(applied.json));
  const afterApply = await req('GET', `/api/grouping/runs/${runId}`, { cookie });
  const planAfter = afterApply.json.plans.find((p: any) => p.id === planId);
  check(
    'swap 后快照互换',
    planAfter.groups[0].includes(userB) && planAfter.groups[1].includes(userA) && !planAfter.groups[0].includes(userA),
    JSON.stringify(planAfter.groups)
  );

  // 7) 还原
  const reset = await req('POST', `/api/grouping/plans/${planId}/reset`, { cookie });
  check('还原成功', reset.status === 200 && reset.json?.ok === true);
  const afterReset = await req('GET', `/api/grouping/runs/${runId}`, { cookie });
  const planReset = afterReset.json.plans.find((p: any) => p.id === planId);
  check('还原后与原始一致', JSON.stringify(planReset.groups) === JSON.stringify(plans[0].groups));

  // 8) 破坏硬约束：插一条 active 的不可同组约束，把两人拖到一起应被拒绝
  const forbiddenA = plans[0].groups[0][0];
  const forbiddenB = plans[0].groups[1][0];
  await db.execute(
    sql`INSERT INTO constraints (course_id, type, member_a, member_b, status) VALUES (${course.id}, 'no_same_group', ${forbiddenA}, ${forbiddenB}, 'active')`
  );
  const denied = await req('POST', `/api/grouping/plans/${planId}/apply-move`, {
    cookie,
    body: { userId: forbiddenA, fromGroup: 0, toGroup: 1 }
  });
  check(
    '破坏不可同组约束被拒绝且给出原因',
    denied.json?.ok === false && Array.isArray(denied.json?.violations) && denied.json.violations.length > 0,
    JSON.stringify(denied.json)
  );

  // 9) 选定方案 → 落库 groups
  const selectRes = await req('POST', `/api/grouping/plans/${planId}/select`, { cookie });
  check('选定方案 200', selectRes.status === 200 && selectRes.json?.ok === true, JSON.stringify(selectRes.json));

  const groupsRes = await req('GET', `/api/courses/${course.id}/groups`, { cookie });
  const groupList = groupsRes.json?.groups ?? [];
  check('落库 3 个小组', groupList.length === 3, JSON.stringify(groupList.length));
  check('小组含成员', groupList.every((g: any) => g.members.length >= 3 && g.members.length <= 5));
  check('成员总数 12', groupList.reduce((n: number, g: any) => n + g.members.length, 0) === 12);

  // 10) 重复选定被拒（已有进行中分组）
  const selectAgain = await req('POST', `/api/grouping/plans/${planId}/select`, { cookie });
  check('重复选定被拒绝', selectAgain.status === 400);

  // ---- 清理 ----
  await db.delete(courses).where(eq(courses.id, course.id));
  await db.delete(users).where(like(users.email, `%-${RUN}@test.local`));

  console.log(failures === 0 ? 'GROUPING SMOKE PASS' : `GROUPING SMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke 脚本异常：', err);
  process.exit(1);
});

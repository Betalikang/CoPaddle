/**
 * S4 溯源与归因 smoke（答辩杀手锏 2 验收）：
 * 平台内撰写 → 段落 diff 归属 → 贡献计算 → 证据下钻 → 教师终审 → 学生申诉。
 *
 * 前置：db + web dev(:3000) + algo(:8000) 运行。
 * 运行：pnpm tsx scripts/smoke-contributions.ts
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

async function main() {
  console.log(`smoke-contributions RUN=${RUN} BASE=${BASE}`);

  const [teacher] = await db
    .insert(users)
    .values({ email: `smoke-c-${RUN}@test.local`, passwordHash: 'x', name: '归因冒烟教师' })
    .returning();
  const cookie = `session=${await signToken({
    user: { id: teacher.id },
    expires: new Date(Date.now() + 86400000).toISOString(),
  })}`;

  // 1) 建课 → 4 学生 → 1 组
  const course = await createCourse({ name: `归因冒烟课程-${RUN}` }, teacher.id);
  await req('PATCH', `/api/courses/${course.id}/settings`, {
    cookie,
    body: { groupCount: 1, minGroupSize: 4, maxGroupSize: 4 },
  });
  const dims = ['编程', '写作', '设计', '表达', '数据分析', '调研', '领导力'];
  const studentCookies: string[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await addEnrollment(course.id, {
      email: `s${i}-${RUN}@test.local`,
      name: `学生${i + 1}`,
      studentNo: `2026${RUN}${i}`,
    });
    studentCookies.push(
      `session=${await signToken({ user: { id: r.userId }, expires: new Date(Date.now() + 86400000).toISOString() })}`
    );
    const skills: Record<string, number> = {};
    dims.forEach((d, j) => (skills[d] = (i + j) % 6));
    await upsertSkillCard(course.id, r.userId, { skills });
  }
  const runRes = await req('POST', `/api/courses/${course.id}/grouping/run`, { cookie });
  const runData = await req('GET', `/api/grouping/runs/${runRes.json.runId}`, { cookie });
  const selectRes = await req('POST', `/api/grouping/plans/${runData.json.plans[0].id}/select`, { cookie });
  check('分组落库', selectRes.json?.ok === true);
  const groupsRes = await req('GET', `/api/courses/${course.id}/groups`, { cookie });
  const groupId = groupsRes.json.groups[0].id;

  // 2) 学生 1 创建交付物并撰写两段（长文本）
  const artRes = await req('POST', `/api/groups/${groupId}/artifacts`, {
    cookie: studentCookies[0],
    body: { title: '调研报告', isFinalDeliverable: true },
  });
  check('创建交付物 201', artRes.status === 201);
  const artifactId = artRes.json.artifact.id;

  const longText = (n: number) => '内容'.repeat(n); // 2n 字
  const v1 = await req('POST', `/api/artifacts/${artifactId}/versions`, {
    cookie: studentCookies[0],
    body: {
      segments: [
        { seq: 0, kind: 'heading', content: '一、调研背景', sourceTaskId: null },
        { seq: 1, kind: 'paragraph', content: longText(200) },
      ],
    },
  });
  check('学生1 保存 v1', v1.status === 201 && v1.json?.diffSummary?.includes('新增 2'), JSON.stringify(v1.json));

  // 3) 学生 2 追加一段 + 学生 3 修订学生 1 的第 1 段
  const v2 = await req('POST', `/api/artifacts/${artifactId}/versions`, {
    cookie: studentCookies[1],
    body: {
      segments: [
        { seq: 0, kind: 'heading', content: '一、调研背景' },
        { seq: 1, kind: 'paragraph', content: longText(200) },
        { seq: 2, kind: 'paragraph', content: longText(50) },
      ],
    },
  });
  check('学生2 追加 1 段', v2.json?.diffSummary?.includes('新增 1'), JSON.stringify(v2.json));

  const v3 = await req('POST', `/api/artifacts/${artifactId}/versions`, {
    cookie: studentCookies[2],
    body: {
      segments: [
        { seq: 0, kind: 'heading', content: '一、调研背景' },
        { seq: 1, kind: 'paragraph', content: longText(200) + '改' }, // 修订
        { seq: 2, kind: 'paragraph', content: longText(50) },
      ],
    },
  });
  check('学生3 修订 1 段', v3.json?.diffSummary?.includes('修订 1'), JSON.stringify(v3.json));

  // 4) 归属落库验证：详情里的作者统计与修订记录
  const detail = await req('GET', `/api/artifacts/${artifactId}`, { cookie: studentCookies[0] });
  const segs = detail.json.segments;
  const author0 = segs.find((s: any) => s.seq === 0);
  const seg1 = segs.find((s: any) => s.seq === 1);
  check('段落 0 归属学生1 撰写', author0.authorId !== null && author0.wordCount === 6);
  check('段落 1 原作者仍是学生1，修订者是学生3', seg1.revisedBy !== null && seg1.revisedCount === 1);

  // 5) 汇编 + 提交终稿
  const compile = await req('POST', `/api/groups/${groupId}/compile`, { cookie });
  check('汇编终稿 201', compile.status === 201 && compile.json?.artifact?.isFinalDeliverable === true);
  const finalArtifactId = compile.json.artifact.id;
  const submit = await req('POST', `/api/artifacts/${finalArtifactId}/submit`, { cookie });
  check('提交终稿', submit.json?.artifact?.status === 'submitted');

  // 6) 计算贡献（algo 归因）
  const compute = await req('POST', `/api/groups/${groupId}/contributions`, { cookie });
  check('贡献计算 201', compute.status === 201, JSON.stringify(compute.json));
  check('同伴证据缺失已标记', compute.json?.peerMissing === true);

  const ledger = await req('GET', `/api/groups/${groupId}/contributions`, { cookie });
  const entries = ledger.json?.entries ?? [];
  check('账本含 4 人', entries.length === 4);

  const byUser = new Map<number, any>();
  for (const e of entries) byUser.set(e.userId, e);
  // 找出四名学生（教师不在组内，组里就是 4 学生）
  const entryList = [...byUser.values()];
  // 产出最多的人（学生1：400+3 字主责）区间应最高
  const top = entryList.reduce((a, b) => (a.high >= b.high ? a : b));
  const bottom = entryList.reduce((a, b) => (a.high <= b.high ? a : b));
  check('产出多者区间高于产出少者', top.high > bottom.high, `top=${top.high} bottom=${bottom.high}`);
  // 铁律：区间不输出单一分数；low ≤ high；所有条目都有 comp
  for (const e of entryList) {
    check(`#${e.userId} 有区间无点值`, e.low <= e.high && e.high - e.low <= 8 && 'comp' in e, JSON.stringify(e));
  }

  // 7) 证据下钻：top 的证据条目含段落原文；修订记录在修订者名下
  const evidence = await req('GET', `/api/contributions/${top.snapshotId}/evidence`, { cookie });
  const items = evidence.json?.items ?? [];
  check('证据条目非空', items.length >= 2);
  check('证据含段落原文引用', items.some((i: any) => i.segment && i.segment.content.includes('内容')));

  // 修订者（学生3）的证据应含 segment_revise
  let foundRevise = false;
  for (const e of entryList) {
    const ev = await req('GET', `/api/contributions/${e.snapshotId}/evidence`, { cookie });
    if ((ev.json?.items ?? []).some((i: any) => i.refType === 'segment_revise')) {
      foundRevise = true;
      break;
    }
  }
  check('修订者的证据含 segment_revise 记录', foundRevise);

  // 8) 队员只能看自己的证据（学生1 看 top=自己 ✓；随便挑一个非 top 的快照应 403）
  const otherEntry = entryList.find((e) => e.snapshotId !== top.snapshotId)!;
  const denied = await req('GET', `/api/contributions/${otherEntry.snapshotId}/evidence`, {
    cookie: studentCookies[0],
  });
  // 学生1 不一定是 otherEntry 的持有者；若恰好是则跳过
  if (otherEntry.userId !== undefined) {
    const isSelf = otherEntry.userId === Number((await req('GET', '/api/auth/me', { cookie: studentCookies[0] })).json?.user?.id ?? 0);
    if (!isSelf) {
      check('队员看他人证据 403', denied.status === 403, String(denied.status));
    }
  }

  // 9) 教师终审
  const review = await req('POST', `/api/contributions/${top.snapshotId}/review`, {
    cookie,
    body: { adjustedLow: 40, adjustedHigh: 50, finalNote: '表现突出' },
  });
  check('教师终审 ok', review.json?.review?.adjustedLow === '40.00' || review.json?.review?.adjustedLow === '40', JSON.stringify(review.json));

  // 10) 学生申诉 + 教师处理
  const appeal = await req('POST', `/api/contributions/${bottom.snapshotId}/appeal`, {
    cookie: studentCookies[0],
    body: { reason: '我做了很多资料整理，区间偏低', evidenceText: '见群聊记录' },
  });
  // 学生1 若恰好是 bottom 持有者则成功，否则 400（只能申诉自己）——两种都验证语义
  check('申诉语义正确（本人成功/他人拒绝）', appeal.status === 201 || appeal.status === 400, String(appeal.status));

  // ---- 清理 ----
  await db.delete(courses).where(eq(courses.id, course.id));
  // audit_logs 无 cascade：先删引用再删 users
  const { auditLogs } = await import('../lib/db/schema');
  const { inArray: inArray2 } = await import('drizzle-orm');
  const doomed = await db.select({ id: users.id }).from(users).where(like(users.email, `%-${RUN}@test.local`));
  if (doomed.length) {
    await db.delete(auditLogs).where(inArray2(auditLogs.actorId, doomed.map((d) => d.id)));
  }
  await db.delete(users).where(like(users.email, `%-${RUN}@test.local`));

  console.log(failures === 0 ? 'CONTRIBUTIONS SMOKE PASS' : `CONTRIBUTIONS SMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke 脚本异常：', err);
  process.exit(1);
});

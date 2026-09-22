import { NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import {
  attributionReviews,
  contributionSnapshots,
  groupMembers,
  groups,
  peerReviewRounds,
  peerReviews,
  taskAssignments,
  tasks,
  users,
} from '@/lib/db/schema';

/** 成绩导出（规格书 B-14）：贡献区间 + 教师终审值 + 任务完成率 + 互评中位数。 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  // 全课程小组与成员
  const groupRows = await db.select().from(groups).where(eq(groups.courseId, courseId)).orderBy(groups.id);
  const groupName = new Map(groupRows.map((g) => [g.id, g.name]));
  const groupIds = groupRows.map((g) => g.id);

  const header = '学号,姓名,小组,角色,贡献区间低,贡献区间高,终审低,终审高,互评中位数,任务完成率';
  if (groupIds.length === 0) {
    return new Response('\uFEFF' + header + '\n', {
      headers: { 'Content-Type': 'text/csv; charset=utf-8' },
    });
  }

  const gm = await db.select().from(groupMembers).where(inArray(groupMembers.groupId, groupIds));
  const userIds = [...new Set(gm.map((m) => m.userId))];
  const userRows = userIds.length ? await db.select().from(users).where(inArray(users.id, userIds)) : [];
  const userMap = new Map(userRows.map((u) => [u.id, u]));

  // 每组最新快照
  const latestByGroup = new Map<number, string>();
  for (const gid of groupIds) {
    const [row] = await db
      .select({ at: contributionSnapshots.snapshotAt })
      .from(contributionSnapshots)
      .where(eq(contributionSnapshots.groupId, gid))
      .orderBy(desc(contributionSnapshots.snapshotAt))
      .limit(1);
    if (row) latestByGroup.set(gid, row.at.toISOString());
  }

  const snapRows = latestByGroup.size ? await db.select().from(contributionSnapshots) : [];
  const latestSnaps = snapRows.filter((s) => latestByGroup.get(s.groupId) === s.snapshotAt.toISOString());
  const snapByUser = new Map(latestSnaps.map((s) => [s.userId, s]));

  const reviewRows = latestSnaps.length
    ? await db
        .select()
        .from(attributionReviews)
        .where(inArray(attributionReviews.snapshotId, latestSnaps.map((s) => s.id)))
    : [];
  const snapById = new Map(latestSnaps.map((s) => [s.id, s]));
  const reviewByUser = new Map(
    reviewRows.map((r) => [snapById.get(r.snapshotId)?.userId ?? 0, r] as const)
  );

  // 任务完成率（主责口径）
  const assignRows = userIds.length
    ? await db.select().from(taskAssignments).where(inArray(taskAssignments.userId, userIds))
    : [];
  const taskIds = [...new Set(assignRows.map((a) => a.taskId))];
  const taskRows = taskIds.length ? await db.select().from(tasks).where(inArray(tasks.id, taskIds)) : [];
  const taskById = new Map(taskRows.map((t) => [t.id, t]));
  const completion = new Map<number, { done: number; total: number }>();
  for (const a of assignRows) {
    if (a.raci !== 'lead') continue;
    const t = taskById.get(a.taskId);
    if (!t) continue;
    const c = completion.get(a.userId) ?? { done: 0, total: 0 };
    c.total += 1;
    if (t.status === 'done') c.done += 1;
    completion.set(a.userId, c);
  }

  // 互评中位数（最近 closed/published 轮次）
  const rounds = await db
    .select()
    .from(peerReviewRounds)
    .where(
      and(eq(peerReviewRounds.courseId, courseId), inArray(peerReviewRounds.status, ['closed', 'published']))
    )
    .orderBy(desc(peerReviewRounds.createdAt))
    .limit(1);
  const peerMedian = new Map<number, number>();
  if (rounds.length) {
    const reviews = await db.select().from(peerReviews).where(eq(peerReviews.roundId, rounds[0].id));
    const byReviewee = new Map<number, number[]>();
    for (const r of reviews) {
      const vals = Object.values(r.scores);
      byReviewee.set(r.revieweeId, [
        ...(byReviewee.get(r.revieweeId) ?? []),
        vals.reduce((a, b) => a + b, 0) / Math.max(vals.length, 1),
      ]);
    }
    for (const [uid, scores] of byReviewee) {
      const s = [...scores].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      peerMedian.set(uid, Math.round(median * 100) / 100);
    }
  }

  const lines = [header];
  for (const m of gm) {
    const u = userMap.get(m.userId);
    const snap = snapByUser.get(m.userId);
    const review = reviewByUser.get(m.userId);
    const comp = completion.get(m.userId);
    const doneRate = comp && comp.total ? `${comp.done}/${comp.total}` : '0/0';
    const med = peerMedian.get(m.userId);
    lines.push(
      [
        u?.studentNo ?? '',
        u?.name ?? '',
        groupName.get(m.groupId) ?? '',
        m.duty,
        snap ? Number(snap.lowPct).toFixed(1) : '',
        snap ? Number(snap.highPct).toFixed(1) : '',
        review?.adjustedLow ? Number(review.adjustedLow).toFixed(1) : '',
        review?.adjustedHigh ? Number(review.adjustedHigh).toFixed(1) : '',
        med ?? "",
        doneRate,
      ].join(",")
    );
  }

  const csv = "\uFEFF" + lines.join("\n"); // BOM 保证 Excel 中文不乱码
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="grades-${courseId}.csv"`,
    },
  });
}

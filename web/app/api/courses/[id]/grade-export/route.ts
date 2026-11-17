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
import { parseId } from '@/lib/api/params';

/** 导出列白名单：key 与前端 `grades/page.tsx` 的 COLUMNS 一一对应，顺序即默认列顺序。 */
const COLUMN_DEFS = [
  { key: 'student_no', label: '学号' },
  { key: 'name', label: '姓名' },
  { key: 'group', label: '小组' },
  { key: 'duty', label: '角色' },
  { key: 'low', label: '贡献区间低' },
  { key: 'high', label: '贡献区间高' },
  { key: 'review_low', label: '终审低' },
  { key: 'review_high', label: '终审高' },
  { key: 'peer_median', label: '互评中位数' },
  { key: 'task_rate', label: '任务完成率' },
] as const;

type ColumnKey = (typeof COLUMN_DEFS)[number]['key'];

const DEFAULT_COLUMNS: ColumnKey[] = COLUMN_DEFS.map((c) => c.key);

/**
 * 解析 `?cols=name,student_no`：只保留白名单内的列，白名单外的静默忽略。
 * 未传 cols（或过滤后为空）时回落到原来的 10 列，保证旧链接行为不变。
 */
function parseCols(rawUrl: string): ColumnKey[] {
  let raw: string | null = null;
  try {
    raw = new URL(rawUrl).searchParams.get('cols');
  } catch {
    raw = null;
  }
  if (raw === null) return DEFAULT_COLUMNS;
  const asked = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const picked = DEFAULT_COLUMNS.filter((k) => asked.has(k));
  return picked.length > 0 ? picked : DEFAULT_COLUMNS;
}

/**
 * CSV 字段转义：含逗号 / 双引号 / 换行的字段用双引号包裹，内部引号写成两个引号。
 * 姓名里带个逗号原本会把整行错位（审计 #52）。
 */
function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** 成绩导出（规格书 B-14）：贡献区间 + 教师终审值 + 任务完成率 + 互评中位数。 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const courseId = parseId(id);
  if (courseId === null) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  // 前端勾选的列（审计 #51）：列顺序仍按白名单固定顺序，避免勾选顺序影响表头
  const pickedColumns = parseCols(request.url);
  const headerLine = pickedColumns
    .map((k) => csvField(COLUMN_DEFS.find((c) => c.key === k)?.label ?? k))
    .join(',');

  // 全课程小组与成员
  const groupRows = await db.select().from(groups).where(eq(groups.courseId, courseId)).orderBy(groups.id);
  const groupName = new Map(groupRows.map((g) => [g.id, g.name]));
  const groupIds = groupRows.map((g) => g.id);

  if (groupIds.length === 0) {
    return new Response('\uFEFF' + headerLine + '\n', {
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

  const lines = [headerLine];
  for (const m of gm) {
    const u = userMap.get(m.userId);
    const snap = snapByUser.get(m.userId);
    const review = reviewByUser.get(m.userId);
    const comp = completion.get(m.userId);
    const doneRate = comp && comp.total ? `${comp.done}/${comp.total}` : '0/0';
    const med = peerMedian.get(m.userId);
    const values: Record<ColumnKey, string> = {
      student_no: u?.studentNo ?? '',
      name: u?.name ?? '',
      group: groupName.get(m.groupId) ?? '',
      duty: m.duty,
      low: snap ? Number(snap.lowPct).toFixed(1) : '',
      high: snap ? Number(snap.highPct).toFixed(1) : '',
      review_low: review?.adjustedLow ? Number(review.adjustedLow).toFixed(1) : '',
      review_high: review?.adjustedHigh ? Number(review.adjustedHigh).toFixed(1) : '',
      peer_median: med === undefined ? '' : String(med),
      task_rate: doneRate,
    };
    lines.push(pickedColumns.map((k) => csvField(values[k])).join(','));
  }

  const csv = "\uFEFF" + lines.join("\n"); // BOM 保证 Excel 中文不乱码
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="grades-${courseId}.csv"`,
    },
  });
}

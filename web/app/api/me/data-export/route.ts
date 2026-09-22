import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import {
  artifactSegments,
  contributionSnapshots,
  courseMemberships,
  courses,
  evidenceItems,
  groupMembers,
  groups,
  notifications,
  peerReviews,
  skillCards,
  taskAssignments,
  tasks,
} from '@/lib/db/schema';

/** 导出系统持有的我的全部数据（规格书 S7.4「可查看」）。 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  // 1) 基本信息（脱敏：不回密码哈希）
  const { passwordHash: _ph, ...safeUser } = user;

  // 2) 课程成员关系与课程
  const memberships = await db
    .select()
    .from(courseMemberships)
    .where(eq(courseMemberships.userId, user.id));
  const courseIds = [...new Set(memberships.map((m) => m.courseId))];
  const courseRows = courseIds.length
    ? await db.select().from(courses).where(inArray(courses.id, courseIds))
    : [];

  // 3) 技能卡
  const cards = await db.select().from(skillCards).where(eq(skillCards.userId, user.id));

  // 4) 小组、任务指派与任务
  const gmRows = await db.select().from(groupMembers).where(eq(groupMembers.userId, user.id));
  const groupRows = gmRows.length
    ? await db.select().from(groups).where(inArray(groups.id, gmRows.map((g) => g.groupId)))
    : [];
  const assignments = await db
    .select()
    .from(taskAssignments)
    .where(eq(taskAssignments.userId, user.id));
  const taskIds = [...new Set(assignments.map((a) => a.taskId))];
  const taskRows = taskIds.length
    ? await db.select().from(tasks).where(inArray(tasks.id, taskIds))
    : [];

  // 5) 我撰写的交付物段落（溯源数据）
  const mySegments = await db
    .select()
    .from(artifactSegments)
    .where(eq(artifactSegments.authorId, user.id))
    .limit(500);

  // 6) 贡献快照与证据条目
  const snapshots = await db
    .select()
    .from(contributionSnapshots)
    .where(eq(contributionSnapshots.userId, user.id));
  const snapshotIds = snapshots.map((s) => s.id);
  const evidences = snapshotIds.length
    ? await db.select().from(evidenceItems).where(inArray(evidenceItems.snapshotId, snapshotIds))
    : [];

  // 7) 我发出的互评与我的通知
  const myReviews = await db
    .select()
    .from(peerReviews)
    .where(eq(peerReviews.reviewerId, user.id));
  const myNotifications = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .limit(200);

  return NextResponse.json({
    exportedAt: new Date().toISOString(),
    user: safeUser,
    courseMemberships: memberships,
    courses: courseRows,
    skillCards: cards,
    groupMemberships: gmRows,
    groups: groupRows,
    taskAssignments: assignments,
    tasks: taskRows,
    artifactSegmentsAuthored: mySegments,
    contributionSnapshots: snapshots,
    evidenceItems: evidences,
    peerReviewsSent: myReviews,
    notifications: myNotifications,
    note: "协作倾向（on_time_rate 等）与历史搭档数据仅教师可见，不在本导出范围内（规格书 S5）。",
  });
}

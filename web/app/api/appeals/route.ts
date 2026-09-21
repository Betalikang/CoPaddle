import { NextResponse } from 'next/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { attributionAppeals, contributionSnapshots, courses, groups, users } from '@/lib/db/schema';

/** 申诉列表（教师：我教的课程里待处理的申诉；学生看不到他人，见本人账本入口）。 */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const status = new URL(request.url).searchParams.get('status') ?? undefined;

  // 我教的课程
  const myCourses = await db
    .select({ id: courses.id })
    .from(courses)
    .where(eq(courses.teacherId, user.id));
  const courseIds = myCourses.map((c) => c.id);
  if (courseIds.length === 0) {
    return NextResponse.json({ appeals: [] });
  }

  const myGroups = await db
    .select({ id: groups.id })
    .from(groups)
    .where(inArray(groups.courseId, courseIds));
  const groupIds = myGroups.map((g) => g.id);
  if (groupIds.length === 0) {
    return NextResponse.json({ appeals: [] });
  }

  const snapshotRows = await db
    .select({ id: contributionSnapshots.id })
    .from(contributionSnapshots)
    .where(inArray(contributionSnapshots.groupId, groupIds));
  const snapshotIds = snapshotRows.map((s) => s.id);

  const rows = await db
    .select({
      appeal: attributionAppeals,
      appellant: { id: users.id, name: users.name, email: users.email }
    })
    .from(attributionAppeals)
    .innerJoin(users, eq(attributionAppeals.appellantId, users.id))
    .where(inArray(attributionAppeals.snapshotId, snapshotIds))
    .orderBy(desc(attributionAppeals.createdAt));

  // 默认只返回待处理；status 参数可查全部
  const filtered = status
    ? rows.filter((r) => r.appeal.status === status)
    : rows.filter((r) => r.appeal.status === 'submitted' || r.appeal.status === 'reviewing');

  return NextResponse.json({
    appeals: filtered.map((r) => ({ ...r.appeal, appellant: r.appellant }))
  });
}

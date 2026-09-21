import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { courseMemberships, skillCards, users } from '@/lib/db/schema';

type Params = { params: Promise<{ id: string }> };

/**
 * 技能卡填写进度（规格书 P-06）：谁填了谁没填。
 * 技能卡内容本身是学生自评数据，此接口只回填写状态，不回内容。
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      studentNo: users.studentNo,
      submittedAt: skillCards.submittedAt
    })
    .from(courseMemberships)
    .innerJoin(users, eq(courseMemberships.userId, users.id))
    .leftJoin(
      skillCards,
      and(eq(skillCards.userId, users.id), eq(skillCards.courseId, courseId))
    )
    .where(
      and(
        eq(courseMemberships.courseId, courseId),
        eq(courseMemberships.status, 'active')
      )
    )
    .orderBy(users.studentNo, users.id);

  const filled = rows.filter((r) => r.submittedAt !== null).length;
  return NextResponse.json({
    total: rows.length,
    filled,
    students: rows.map((r) => ({
      userId: r.userId,
      name: r.name,
      studentNo: r.studentNo,
      submitted: r.submittedAt !== null,
      submittedAt: r.submittedAt
    }))
  });
}

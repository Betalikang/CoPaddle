import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { classes, skillCards, users } from '@/lib/db/schema';

type Params = { params: Promise<{ id: string }> };

/** 班级列表（含人数）。教师/助教可读。 */
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
      id: classes.id,
      name: classes.name,
      major: classes.major,
      grade: classes.grade,
      memberCount: classes.memberCount
    })
    .from(classes)
    .where(eq(classes.courseId, courseId))
    .orderBy(classes.name);

  return NextResponse.json({ classes: rows });
}

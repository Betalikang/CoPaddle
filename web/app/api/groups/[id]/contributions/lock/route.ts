import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { groups } from '@/lib/db/schema';
import { lockGroupSnapshots } from '@/lib/services/contributions';

type Params = { params: Promise<{ id: string }> };

/** 批量锁定终审结果（教师）。 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const groupId = Number.parseInt(id, 10);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: '小组 id 无效' }, { status: 400 });
  }

  const [group] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) {
    return NextResponse.json({ error: '小组不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(group.courseId, ['teacher']);
  if (!auth.ok) return auth.response;

  const result = await lockGroupSnapshots(groupId);
  return NextResponse.json(result);
}

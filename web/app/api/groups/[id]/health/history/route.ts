import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { groups } from '@/lib/db/schema';
import { getGroupHealth } from '@/lib/services/health';

type Params = { params: Promise<{ id: string }> };

/** 健康度历史序列（教师端趋势图）。 */
export async function GET(_request: Request, { params }: Params) {
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
  const auth = await assertCourseRole(group.courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const { history } = await getGroupHealth(groupId);
  return NextResponse.json({ history });
}

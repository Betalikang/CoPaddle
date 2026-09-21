import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { groups } from '@/lib/db/schema';
import { dissolveGroup } from '@/lib/services/grouping';

type Params = { params: Promise<{ id: string }> };

/** 解散小组（教师/助教）：成员回池，小组数据归档（规格书 B-07）。 */
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
  // 解散影响面大：仅教师/助教（规格书 S5）
  const auth = await assertCourseRole(group.courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const result = await dissolveGroup(groupId, auth.user.id);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

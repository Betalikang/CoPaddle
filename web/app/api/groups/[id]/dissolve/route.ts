import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { assertGroupAccess } from '@/lib/auth/task-access';
import { db } from '@/lib/db/drizzle';
import { groups } from '@/lib/db/schema';
import { dissolveGroup } from '@/lib/services/grouping';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

/** 解散小组（仅教师）：成员回池，小组数据归档（规格书 B-07 / S5）。 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const groupId = parseId(id);
  if (groupId === null) {
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
  // 解散/合并/拆分影响面大：仅教师（规格书 S5，助教不可）
  const auth = await assertCourseRole(group.courseId, ['teacher'], { write: true });
  if (!auth.ok) return auth.response;
  // 组级归属：队长/队员必须是在册组员（规格书 S5，防组间 IDOR）
  if (!(await assertGroupAccess(groupId, auth.user, auth.membership.role))) {
    return NextResponse.json({ error: '不属于该小组' }, { status: 403 });
  }

  const result = await dissolveGroup(groupId, auth.user.id);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

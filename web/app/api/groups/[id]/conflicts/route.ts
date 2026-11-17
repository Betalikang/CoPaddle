import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { assertGroupAccess, guardGroup } from '@/lib/auth/task-access';
import { db } from '@/lib/db/drizzle';
import { groups } from '@/lib/db/schema';
import { detectConflicts, listConflicts } from '@/lib/services/conflicts';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

async function getGroupCourseId(groupId: number): Promise<number | null> {
  const [row] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  return row?.courseId ?? null;
}

/** 冲突列表（组内可读）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const groupId = parseId(id);
  if (groupId === null) {
    return NextResponse.json({ error: '小组 id 无效' }, { status: 400 });
  }

  const courseId = await getGroupCourseId(groupId);
  if (courseId === null) {
    return NextResponse.json({ error: '小组不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;
  // 组级归属：队长/队员必须是在册组员（规格书 S5，防组间 IDOR）
  if (!(await assertGroupAccess(groupId, auth.user, auth.membership.role))) {
    return NextResponse.json({ error: '不属于该小组' }, { status: 403 });
  }

  const rows = await listConflicts(groupId);
  return NextResponse.json({ conflicts: rows });
}

/** 手动触发冲突检测（队长/教师；系统也会定时自动跑）。 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const groupId = parseId(id);
  if (groupId === null) {
    return NextResponse.json({ error: '小组 id 无效' }, { status: 400 });
  }

  const courseId = await getGroupCourseId(groupId);
  if (courseId === null) {
    return NextResponse.json({ error: '小组不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain'], { write: true });
  if (!auth.ok) return auth.response;
  // 组级归属：队长只能检测自己组（GET 有、POST 原来漏了 → 可向别组写冲突）
  const denied = await guardGroup(groupId, auth);
  if (denied) return denied;

  const result = await detectConflicts(groupId, 'manual');
  return NextResponse.json(result);
}

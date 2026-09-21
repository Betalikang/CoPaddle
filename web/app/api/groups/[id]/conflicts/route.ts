import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { groups } from '@/lib/db/schema';
import { detectConflicts, listConflicts } from '@/lib/services/conflicts';

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
  const groupId = Number.parseInt(id, 10);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: '小组 id 无效' }, { status: 400 });
  }

  const courseId = await getGroupCourseId(groupId);
  if (courseId === null) {
    return NextResponse.json({ error: '小组不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const rows = await listConflicts(groupId);
  return NextResponse.json({ conflicts: rows });
}

/** 手动触发冲突检测（队长/教师；系统也会定时自动跑）。 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const groupId = Number.parseInt(id, 10);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: '小组 id 无效' }, { status: 400 });
  }

  const courseId = await getGroupCourseId(groupId);
  if (courseId === null) {
    return NextResponse.json({ error: '小组不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain']);
  if (!auth.ok) return auth.response;

  const result = await detectConflicts(groupId, 'manual');
  return NextResponse.json(result);
}

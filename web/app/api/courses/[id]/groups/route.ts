import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { listGroups } from '@/lib/services/grouping';

type Params = { params: Promise<{ id: string }> };

/** 全班小组列表（含成员）。课程参与人可读。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const groups = await listGroups(courseId);
  return NextResponse.json({ groups });
}

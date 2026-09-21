import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { listRuns } from '@/lib/services/grouping';

type Params = { params: Promise<{ id: string }> };

/** 历史求解记录（课程参与人可读）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const runs = await listRuns(courseId);
  return NextResponse.json({ runs });
}

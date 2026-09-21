import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getLatestRun } from '@/lib/services/grouping';

type Params = { params: Promise<{ id: string }> };

/** 最近一次成功的求解（分组工作台默认加载）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const data = await getLatestRun(courseId);
  if (!data) {
    return NextResponse.json({ run: null, plans: [] });
  }
  return NextResponse.json(data);
}

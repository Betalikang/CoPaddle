import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getCourseAlerts } from '@/lib/services/health';

type Params = { params: Promise<{ id: string }> };

/** 预警中心：有待处理诊断的小组（按严重度排序）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const alerts = await getCourseAlerts(courseId);
  return NextResponse.json({ alerts });
}

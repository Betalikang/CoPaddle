import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getCourseAlerts, getCourseHealthOverview } from '@/lib/services/health';

type Params = { params: Promise<{ id: string }> };

/** 全班小组健康度总览（教师端热力图）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const overview = await getCourseHealthOverview(courseId);
  return NextResponse.json({ groups: overview });
}

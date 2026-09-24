import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { listCourseReplanEvents } from '@/lib/services/replan';

type Params = { params: Promise<{ id: string }> };

/**
 * 课程级重规划事件列表（重规划中心）。
 * 教师/助教全班；队长/队员仅本组。
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const role = auth.membership.role as 'teacher' | 'assistant' | 'captain' | 'member';
  const events = await listCourseReplanEvents(courseId, auth.user.id, role);
  return NextResponse.json({ events });
}

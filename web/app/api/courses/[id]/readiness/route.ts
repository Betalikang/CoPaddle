import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getCourseReadiness } from '@/lib/services/readiness';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

/**
 * 课程就绪度（教师/助教）。
 *
 * 只读，并且**不触发任何计算**：不跑求解器、不落健康度快照。
 * 教师打开课程首页只是想看「现在到哪一步了」，不该因为看一眼就跑一次求解。
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = parseId(id);
  if (courseId === null) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const readiness = await getCourseReadiness(courseId);
  if (!readiness) {
    return NextResponse.json({ error: '课程不存在' }, { status: 404 });
  }
  return NextResponse.json(readiness);
}
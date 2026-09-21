import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getRunWithPlans } from '@/lib/services/grouping';

type Params = { params: Promise<{ runId: string }> };

/** 求解记录 + 三套方案（含四维得分与当前分组快照）。 */
export async function GET(_request: Request, { params }: Params) {
  const { runId } = await params;
  const id = Number.parseInt(runId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: 'run id 无效' }, { status: 400 });
  }

  const data = await getRunWithPlans(id);
  if (!data) {
    return NextResponse.json({ error: '求解记录不存在' }, { status: 404 });
  }

  // 课程归属鉴权：四种课程角色都可查看方案
  const auth = await assertCourseRole(data.run.courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  return NextResponse.json(data);
}

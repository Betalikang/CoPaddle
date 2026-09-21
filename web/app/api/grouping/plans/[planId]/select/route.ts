import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getPlanCourseId, selectPlan } from '@/lib/services/grouping';

type Params = { params: Promise<{ planId: string }> };

/** 选定方案并落库：生成 groups + group_members（规格书 B-06）。 */
export async function POST(request: Request, { params }: Params) {
  const { planId } = await params;
  const id = Number.parseInt(planId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: '方案 id 无效' }, { status: 400 });
  }

  const courseId = await getPlanCourseId(id);
  if (courseId === null) {
    return NextResponse.json({ error: '方案不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const result = await selectPlan(id, auth.user.id);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

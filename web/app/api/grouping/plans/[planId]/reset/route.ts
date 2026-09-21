import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { AlgoServiceError } from '@/lib/algo/client';
import { getPlanCourseId, resetPlan } from '@/lib/services/grouping';

type Params = { params: Promise<{ planId: string }> };

/** 还原到求解器原始结果。 */
export async function POST(_request: Request, { params }: Params) {
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

  try {
    const result = await resetPlan(id);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AlgoServiceError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
}

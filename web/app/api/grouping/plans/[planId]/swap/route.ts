import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { AlgoServiceError } from '@/lib/algo/client';
import { applyMove, getPlanCourseId } from '@/lib/services/grouping';
import { groupingSwapSchema } from '@/lib/validation/grouping';

type Params = { params: Promise<{ planId: string }> };

/** 两名成员互换组（校验通过才落库）。 */
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

  const parsed = groupingSwapSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await applyMove(id, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ ok: false, violations: result.violations }, { status: 200 });
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AlgoServiceError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
}

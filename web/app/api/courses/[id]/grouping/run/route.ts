import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { AlgoServiceError } from '@/lib/algo/client';
import { runGrouping } from '@/lib/services/grouping';

type Params = { params: Promise<{ id: string }> };

/** 触发生成分组方案（教师/助教）。同步求解 ≤10s，超时走贪心兜底。 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  try {
    const result = await runGrouping(courseId, auth.user.id);
    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ runId: result.runId }, { status: 201 });
  } catch (err) {
    if (err instanceof AlgoServiceError) {
      return NextResponse.json(
        { error: `算法服务不可用：${err.message}。可稍后重试，基础功能不受影响。` },
        { status: 503 }
      );
    }
    throw err;
  }
}

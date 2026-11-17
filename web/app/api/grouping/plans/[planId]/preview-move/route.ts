import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { AlgoServiceError } from '@/lib/algo/client';
import { getPlanCourseId, previewMove } from '@/lib/services/grouping';
import { groupingMoveSchema, groupingSwapSchema } from '@/lib/validation/grouping';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ planId: string }> };

async function authorize(planId: number) {
  const courseId = await getPlanCourseId(planId);
  if (courseId === null) {
    return { ok: false as const, response: NextResponse.json({ error: '方案不存在' }, { status: 404 }) };
  }
  // 拖动微调与选定：核心权限仅教师侧（规格书 S5）。
  // 这里刻意不加 { write: true }：预演不落库，归档课程也应该能看「如果这么移动会怎样」。
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return { ok: false as const, response: auth.response };
  return { ok: true as const };
}

/** 拖动预演：返回四维增减、是否破坏硬约束、违规原因（不落库）。 */
export async function POST(request: Request, { params }: Params) {
  const { planId } = await params;
  const id = parseId(planId);
  if (id === null) {
    return NextResponse.json({ error: '方案 id 无效' }, { status: 400 });
  }
  const auth = await authorize(id);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const moveParsed = groupingMoveSchema.safeParse(body);
  const swapParsed = moveParsed.success ? null : groupingSwapSchema.safeParse(body);
  const input = moveParsed.success
    ? moveParsed.data
    : swapParsed?.success
      ? swapParsed.data
      : null;
  if (!input) {
    return NextResponse.json({ error: '参数错误（需要 move 或 swap 字段）' }, { status: 400 });
  }

  try {
    const result = await previewMove(id, input);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AlgoServiceError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    throw err;
  }
}

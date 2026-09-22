import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertCourseRole } from '@/lib/auth/course-access';
import { createRound, listRounds } from '@/lib/services/peer-reviews';

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  name: z.string().min(1, '轮次名称不能为空').max(100),
  openAt: z.string().datetime().nullable().optional(),
  closeAt: z.string().datetime().nullable().optional(),
  dimensions: z.array(z.object({ key: z.string().max(10), label: z.string().max(20) })).optional(),
  isAnonymous: z.boolean().optional()
});

/** 轮次列表（教师/助教）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const rounds = await listRounds(courseId);
  return NextResponse.json({ rounds });
}

/** 新建轮次（时间窗、维度、是否匿名；教师/助教）。 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  const round = await createRound(courseId, auth.user.id, parsed.data);
  return NextResponse.json({ round }, { status: 201 });
}

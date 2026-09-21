import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getSnapshotCourseId, submitAppeal } from '@/lib/services/contributions';

type Params = { params: Promise<{ snapshotId: string }> };

const appealSchema = z.object({
  reason: z.string().min(1, '请填写申诉理由').max(1000),
  evidenceText: z.string().max(5000).optional()
});

/** 学生提交申诉（仅针对本人账本，规格书 S4.7 红线：有申诉机制才能被接受）。 */
export async function POST(request: Request, { params }: Params) {
  const { snapshotId } = await params;
  const id = Number.parseInt(snapshotId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: '快照 id 无效' }, { status: 400 });
  }

  const courseId = await getSnapshotCourseId(id);
  if (courseId === null) {
    return NextResponse.json({ error: '账本不存在' }, { status: 404 });
  }
  // 队长/队员可申诉（仅限本人）
  const auth = await assertCourseRole(courseId, ['captain', 'member']);
  if (!auth.ok) return auth.response;

  const parsed = appealSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const appeal = await submitAppeal(id, auth.user.id, parsed.data);
    return NextResponse.json({ appeal }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '申诉失败' },
      { status: 400 }
    );
  }
}

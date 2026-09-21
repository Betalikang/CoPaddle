import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getSnapshotCourseId, reviewSnapshot } from '@/lib/services/contributions';

type Params = { params: Promise<{ snapshotId: string }> };

const reviewSchema = z.object({
  adjustedLow: z.number().min(0).max(100).nullable().optional(),
  adjustedHigh: z.number().min(0).max(100).nullable().optional(),
  finalNote: z.string().max(2000).optional()
});

/** 教师终审：调整区间并填写评语（助教不可终审，规格书 S5）。 */
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
  const auth = await assertCourseRole(courseId, ['teacher']);
  if (!auth.ok) return auth.response;

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  const review = await reviewSnapshot(id, auth.user.id, parsed.data);
  return NextResponse.json({ review });
}

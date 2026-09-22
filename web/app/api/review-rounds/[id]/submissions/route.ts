import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { peerReviewRounds } from '@/lib/db/schema';
import { submitReview } from '@/lib/services/peer-reviews';

type Params = { params: Promise<{ id: string }> };

const submitSchema = z.object({
  revieweeId: z.number().int().positive(),
  scores: z.record(z.string().max(10), z.number().min(1).max(5)),
  comment: z.string().max(1000).optional()
});

/** 提交评价（五维评分 + 文字评语；提交后不可改——覆盖写需教师重置，S6 从简）。 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const roundId = Number.parseInt(id, 10);
  if (!Number.isFinite(roundId)) {
    return NextResponse.json({ error: '轮次 id 无效' }, { status: 400 });
  }

  const [round] = await db
    .select({ courseId: peerReviewRounds.courseId })
    .from(peerReviewRounds)
    .where(eq(peerReviewRounds.id, roundId))
    .limit(1);
  if (!round) {
    return NextResponse.json({ error: '轮次不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(round.courseId, ['captain', 'member', 'teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const parsed = submitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await submitReview(roundId, auth.user.id, parsed.data);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ review: result.review }, { status: 201 });
}

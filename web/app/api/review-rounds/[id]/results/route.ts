import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { peerReviewRounds } from '@/lib/db/schema';
import { roundResults } from '@/lib/services/peer-reviews';

type Params = { params: Promise<{ id: string }> };

/** 结果：去极值中位数 + 组内排名（教师/助教；学生走个人视角）。 */
export async function GET(_request: Request, { params }: Params) {
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
  const auth = await assertCourseRole(round.courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const data = await roundResults(roundId);
  return NextResponse.json(data);
}

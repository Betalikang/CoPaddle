import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { peerReviewRounds } from '@/lib/db/schema';
import { openRound } from '@/lib/services/peer-reviews';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

/** 轮次状态流转（教师/助教）。 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const roundId = parseId(id);
  if (roundId === null) {
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
  const auth = await assertCourseRole(round.courseId, ['teacher', 'assistant'], { write: true });
  if (!auth.ok) return auth.response;

  const result = await openRound(roundId);
  // 已开启/已关闭的轮次不能再「开启」：重复点击此前会静默成功并重置状态
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  return NextResponse.json({ round: result.round });
}

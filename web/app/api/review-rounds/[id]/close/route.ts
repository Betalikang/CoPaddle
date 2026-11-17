import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { peerReviewRounds } from '@/lib/db/schema';
import { closeRound } from '@/lib/services/peer-reviews';
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

  const result = await closeRound(roundId);
  // 只有「进行中」才能关闭：重复关闭会让异常检测重跑，未开启就关闭则收不到任何提交
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  return NextResponse.json({ round: result.round });
}

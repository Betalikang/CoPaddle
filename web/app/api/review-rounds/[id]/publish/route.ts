import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { peerReviewRounds } from '@/lib/db/schema';
import { publishRound } from '@/lib/services/peer-reviews';
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

  const result = await publishRound(roundId);
  // 前态不合法（还没关闭就发布 / 已发布重复点）要回 409，而不是回一个
  // 看似成功的响应——前端 `act()` 只看 res.ok，200 就会被当成发布成功。
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 409 });
  }
  return NextResponse.json({ round: result.round });
}

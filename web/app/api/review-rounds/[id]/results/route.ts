import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { peerReviewRounds } from '@/lib/db/schema';
import { roundResults } from '@/lib/services/peer-reviews';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

/** 结果：去极值中位数 + 组内排名（教师/助教看全班；学生只看自己那一行）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const roundId = parseId(id);
  if (roundId === null) {
    return NextResponse.json({ error: '轮次 id 无效' }, { status: 400 });
  }
  const [round] = await db
    .select({ courseId: peerReviewRounds.courseId, status: peerReviewRounds.status })
    .from(peerReviewRounds)
    .where(eq(peerReviewRounds.id, roundId))
    .limit(1);
  if (!round) {
    return NextResponse.json({ error: '轮次不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(round.courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const role = auth.membership.role;
  const privileged = role === 'teacher' || role === 'assistant';

  // 未发布的轮次不给学生看：否则 draft/scheduled 阶段就能探到分数
  if (!privileged && round.status !== 'published') {
    return NextResponse.json({ error: '结果尚未发布' }, { status: 403 });
  }

  const data = await roundResults(roundId);
  if (!data) {
    return NextResponse.json({ error: '轮次不存在' }, { status: 404 });
  }

  // 学生只能看到自己：原来直接返回全班 119 人的姓名/学号/中位数/排名
  if (privileged) return NextResponse.json(data);
  return NextResponse.json({
    round: data.round,
    results: data.results.filter((r) => r.userId === auth.user.id)
  });
}

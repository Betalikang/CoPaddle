import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { peerReviewRounds } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { myReviewTasks } from '@/lib/services/peer-reviews';
import { getUser } from '@/lib/db/queries';

type Params = { params: Promise<{ id: string }> };

async function getRoundCourseId(roundId: number): Promise<number | null> {
  const [row] = await db
    .select({ courseId: peerReviewRounds.courseId })
    .from(peerReviewRounds)
    .where(eq(peerReviewRounds.id, roundId))
    .limit(1);
  return row?.courseId ?? null;
}

/** 我需要评谁（含已提交状态）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const roundId = Number.parseInt(id, 10);
  if (!Number.isFinite(roundId)) {
    return NextResponse.json({ error: '轮次 id 无效' }, { status: 400 });
  }
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const courseId = await getRoundCourseId(roundId);
  if (courseId === null) {
    return NextResponse.json({ error: '轮次不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const data = await myReviewTasks(roundId, auth.user.id);
  return NextResponse.json(data);
}

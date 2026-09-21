import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { groups, replanEvents } from '@/lib/db/schema';
import { getReplanEvent } from '@/lib/services/replan';

type Params = { params: Promise<{ id: string }> };

/** 重规划事件详情 + 三方案对比（组内可读）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const eventId = Number.parseInt(id, 10);
  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: '事件 id 无效' }, { status: 400 });
  }

  const data = await getReplanEvent(eventId);
  if (!data) {
    return NextResponse.json({ error: '事件不存在' }, { status: 404 });
  }
  const [group] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, data.event.groupId))
    .limit(1);
  if (!group) {
    return NextResponse.json({ error: '事件不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(group.courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  return NextResponse.json(data);
}

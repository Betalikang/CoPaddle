import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { guardGroup } from '@/lib/auth/task-access';
import { db } from '@/lib/db/drizzle';
import { groups, replanEvents } from '@/lib/db/schema';
import { getReplanEvent } from '@/lib/services/replan';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

/** 重规划事件详情 + 三方案对比（组内可读）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const eventId = parseId(id);
  if (eventId === null) {
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
  // 组级归属：非教师/助教只能看自己组的事件
  const denied = await guardGroup(data.event.groupId, auth);
  if (denied) return denied;

  return NextResponse.json(data);
}

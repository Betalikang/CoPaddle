import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { groups, replanEvents, replanOptions } from '@/lib/db/schema';
import { adoptOption } from '@/lib/services/replan';

type Params = { params: Promise<{ id: string; optionId: string }> };

/**
 * 采纳方案（规格书 S5 权限）：
 * 「重新分配」教师/助教/队长可采纳；「缩减范围」「组间补位」仅教师
 * （涉及课程要求变更与跨组人力）。
 */
export async function POST(_request: Request, { params }: Params) {
  const { id, optionId } = await params;
  const eventId = Number.parseInt(id, 10);
  const optId = Number.parseInt(optionId, 10);
  if (!Number.isFinite(eventId) || !Number.isFinite(optId)) {
    return NextResponse.json({ error: '参数无效' }, { status: 400 });
  }

  const [event] = await db
    .select()
    .from(replanEvents)
    .where(eq(replanEvents.id, eventId))
    .limit(1);
  if (!event) {
    return NextResponse.json({ error: '事件不存在' }, { status: 404 });
  }
  const [group] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, event.groupId))
    .limit(1);
  if (!group) {
    return NextResponse.json({ error: '事件不存在' }, { status: 404 });
  }

  // 按方案动作判权限
  const [option] = await db
    .select()
    .from(replanOptions)
    .where(eq(replanOptions.id, optId))
    .limit(1);
  if (!option || option.eventId !== eventId) {
    return NextResponse.json({ error: '方案不存在' }, { status: 404 });
  }
  const roles =
    option.action === 'redistribute'
      ? (['teacher', 'assistant', 'captain'] as const)
      : (['teacher'] as const);
  const auth = await assertCourseRole(group.courseId, [...roles]);
  if (!auth.ok) {
    return NextResponse.json(
      { error: option.action === 'redistribute' ? '无权采纳该方案' : '「缩减范围/组间补位」需要教师采纳' },
      { status: 403 }
    );
  }

  const result = await adoptOption(eventId, optId, auth.user.id);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { groups, replanEvents } from '@/lib/db/schema';
import { rejectEvent } from '@/lib/services/replan';

type Params = { params: Promise<{ id: string }> };

const rejectSchema = z.object({
  reason: z.string().min(1, '拒绝必须填写理由').max(1000)
});

/** 拒绝方案（必须填理由，进审计；队长/教师）。 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const eventId = Number.parseInt(id, 10);
  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: '事件 id 无效' }, { status: 400 });
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
  const auth = await assertCourseRole(group.courseId, ['teacher', 'assistant', 'captain']);
  if (!auth.ok) return auth.response;

  const parsed = rejectSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await rejectEvent(eventId, auth.user.id, parsed.data.reason);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

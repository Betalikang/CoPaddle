import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { groups } from '@/lib/db/schema';
import { getConflict, resolveConflict } from '@/lib/services/conflicts';

type Params = { params: Promise<{ id: string }> };

const resolveSchema = z.object({
  action: z.enum(['merge', 'realign', 'reassign', 'dismiss']),
  note: z.string().max(1000).optional(),
  payload: z.record(z.unknown()).optional()
});

/** 处理冲突：就地合并 / 退回对齐契约 / 重指派 / 驳回（队长/教师）。 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const conflictId = Number.parseInt(id, 10);
  if (!Number.isFinite(conflictId)) {
    return NextResponse.json({ error: '冲突 id 无效' }, { status: 400 });
  }

  const data = await getConflict(conflictId);
  if (!data) {
    return NextResponse.json({ error: '冲突不存在' }, { status: 404 });
  }
  const [group] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, data.conflict.groupId))
    .limit(1);
  if (!group) {
    return NextResponse.json({ error: '冲突不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(group.courseId, ['teacher', 'assistant', 'captain']);
  if (!auth.ok) return auth.response;

  const parsed = resolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await resolveConflict(conflictId, auth.user.id, parsed.data);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json(result);
}


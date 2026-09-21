import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getTaskCourseId } from '@/lib/auth/task-access';
import { unassign } from '@/lib/services/tasks';

type Params = { params: Promise<{ id: string; userId: string }> };

/** 取消指派（队长）。按 taskId+userId 删全部 RACI 记录。 */
export async function DELETE(_request: Request, { params }: Params) {
  const { id, userId } = await params;
  const taskId = Number.parseInt(id, 10);
  const memberId = Number.parseInt(userId, 10);
  if (!Number.isFinite(taskId) || !Number.isFinite(memberId)) {
    return NextResponse.json({ error: '参数无效' }, { status: 400 });
  }

  const courseId = await getTaskCourseId(taskId);
  if (courseId === null) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain']);
  if (!auth.ok) return auth.response;

  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/lib/db/drizzle');
  const { taskAssignments } = await import('@/lib/db/schema');
  await db
    .delete(taskAssignments)
    .where(and(eq(taskAssignments.taskId, taskId), eq(taskAssignments.userId, memberId)));
  return NextResponse.json({ ok: true });
}

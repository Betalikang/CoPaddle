import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { parseId } from '@/lib/api/params';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getTaskCourseId, getTaskGroupId, guardGroup } from '@/lib/auth/task-access';
import { db } from '@/lib/db/drizzle';
import { taskAssignments } from '@/lib/db/schema';

type Params = { params: Promise<{ id: string; userId: string }> };

/** 取消指派（队长）。按 taskId+userId 删全部 RACI 记录。 */
export async function DELETE(_request: Request, { params }: Params) {
  const { id, userId } = await params;
  const taskId = parseId(id);
  const memberId = parseId(userId);
  if (taskId === null || memberId === null) {
    return NextResponse.json({ error: '参数无效' }, { status: 400 });
  }

  const courseId = await getTaskCourseId(taskId);
  if (courseId === null) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain'], { write: true });
  if (!auth.ok) return auth.response;
  const groupId = await getTaskGroupId(taskId);
  if (groupId === null) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  const denied = await guardGroup(groupId, auth);
  if (denied) return denied;

  await db
    .delete(taskAssignments)
    .where(and(eq(taskAssignments.taskId, taskId), eq(taskAssignments.userId, memberId)));
  return NextResponse.json({ ok: true });
}

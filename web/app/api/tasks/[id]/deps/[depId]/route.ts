import { NextResponse } from 'next/server';
import { parseId } from '@/lib/api/params';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getTaskCourseId, getTaskGroupId, guardGroup } from '@/lib/auth/task-access';
import { removeDep } from '@/lib/services/tasks';

type Params = { params: Promise<{ id: string; depId: string }> };

/** 删依赖（队长）。路径参数 depId 是上游任务 id。 */
export async function DELETE(_request: Request, { params }: Params) {
  const { id, depId } = await params;
  const taskId = parseId(id);
  const dependsOnId = parseId(depId);
  if (taskId === null || dependsOnId === null) {
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

  await removeDep(taskId, dependsOnId);
  return NextResponse.json({ ok: true });
}

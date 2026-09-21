import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getTaskCourseId } from '@/lib/auth/task-access';
import { removeDep } from '@/lib/services/tasks';

type Params = { params: Promise<{ id: string; depId: string }> };

/** 删依赖（队长）。 */
export async function DELETE(_request: Request, { params }: Params) {
  const { id, depId } = await params;
  const taskId = Number.parseInt(id, 10);
  const dependsOnId = Number.parseInt(depId, 10);
  if (!Number.isFinite(taskId) || !Number.isFinite(dependsOnId)) {
    return NextResponse.json({ error: '参数无效' }, { status: 400 });
  }

  const courseId = await getTaskCourseId(taskId);
  if (courseId === null) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain']);
  if (!auth.ok) return auth.response;

  await removeDep(taskId, dependsOnId);
  return NextResponse.json({ ok: true });
}

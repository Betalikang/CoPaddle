import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getTaskCourseId } from '@/lib/auth/task-access';
import { assignTask } from '@/lib/services/tasks';
import { assignSchema } from '@/lib/validation/tasks';

type Params = { params: Promise<{ id: string }> };

/** 指派主责/协作/审阅（队长）。 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const taskId = Number.parseInt(id, 10);
  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ error: '任务 id 无效' }, { status: 400 });
  }

  const courseId = await getTaskCourseId(taskId);
  if (courseId === null) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain']);
  if (!auth.ok) return auth.response;

  const parsed = assignSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  const assignment = await assignTask(
    taskId,
    parsed.data.userId,
    parsed.data.raci,
    auth.user.id
  );
  // 重复指派（同 task+user+raci）：静默成功
  return NextResponse.json({ assignment }, { status: assignment ? 201 : 200 });
}

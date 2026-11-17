import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getTaskCourseId, getTaskGroupId, guardGroup, isGroupMember } from '@/lib/auth/task-access';
import { assignTask } from '@/lib/services/tasks';
import { assignSchema } from '@/lib/validation/tasks';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

/** 指派主责/协作/审阅（队长）。被指派人必须是本组在册成员。 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const taskId = parseId(id);
  if (taskId === null) {
    return NextResponse.json({ error: '任务 id 无效' }, { status: 400 });
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

  const parsed = assignSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  // 只能指派本组在册成员，避免把外组学生/教师挂到本组任务上
  if (!(await isGroupMember(groupId, parsed.data.userId))) {
    return NextResponse.json({ error: '只能指派本组成员' }, { status: 400 });
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

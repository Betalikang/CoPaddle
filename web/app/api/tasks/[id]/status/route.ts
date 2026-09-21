import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getTaskCourseId, isTaskLead } from '@/lib/auth/task-access';
import { changeTaskStatus } from '@/lib/services/tasks';
import { changeStatusSchema } from '@/lib/validation/tasks';

type Params = { params: Promise<{ id: string }> };

/**
 * 状态流转（组内）。权限：队长/教师/助教可改任意任务；
 * 队员仅能改自己主责（lead）的任务（规格书 S5）。
 * 每次迁移自动写 task_status_events（B-10 的第一手信号）。
 */
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

  const parsed = changeStatusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  // 队员路径：仅限本人 lead 的任务；否则按教师侧角色鉴权
  let actorId: number;
  const memberAuth = await assertCourseRole(courseId, ['member']);
  if (memberAuth.ok) {
    const lead = await isTaskLead(taskId, memberAuth.user.id);
    if (!lead) {
      return NextResponse.json({ error: '只能变更自己主责的任务' }, { status: 403 });
    }
    actorId = memberAuth.user.id;
  } else {
    const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain']);
    if (!auth.ok) return auth.response;
    actorId = auth.user.id;
  }

  const result = await changeTaskStatus(taskId, actorId, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 400 });
  }
  return NextResponse.json({ ok: true, task: result.task });
}

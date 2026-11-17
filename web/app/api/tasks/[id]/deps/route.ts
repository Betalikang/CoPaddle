import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getTaskCourseId, getTaskGroupId, guardGroup } from '@/lib/auth/task-access';
import { addDep } from '@/lib/services/tasks';
import { addDepSchema } from '@/lib/validation/tasks';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

/** 加依赖（队长；写入前环检测，成环拒绝并返回环上任务）。 */
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

  const parsed = addDepSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await addDep(taskId, parsed.data.dependsOnId);
  if (!result.ok) {
    // 业务失败不能再回 200：前端按 body.ok 判断，但状态码要能被网络层/日志识别。
    // 成环用 409（状态冲突），其余（自依赖、跨组）用 400。
    return NextResponse.json(
      { ok: false, reason: result.reason, cycle: result.cycle ?? null },
      { status: result.cycle && result.cycle.length > 0 ? 409 : 400 }
    );
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

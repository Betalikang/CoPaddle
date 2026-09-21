import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getTaskCourseId } from '@/lib/auth/task-access';
import { addDep } from '@/lib/services/tasks';
import { addDepSchema } from '@/lib/validation/tasks';

type Params = { params: Promise<{ id: string }> };

/** 加依赖（队长；写入前环检测，成环拒绝并返回环上任务）。 */
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

  const parsed = addDepSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await addDep(taskId, parsed.data.dependsOnId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason, cycle: result.cycle ?? null });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

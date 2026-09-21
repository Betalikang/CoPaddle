import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getTaskCourseId } from '@/lib/auth/task-access';
import { db } from '@/lib/db/drizzle';
import { tasks } from '@/lib/db/schema';
import { deleteTask, updateTask } from '@/lib/services/tasks';
import { updateTaskSchema } from '@/lib/validation/tasks';

type Params = { params: Promise<{ id: string }> };

async function loadTask(taskId: number) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  return task ?? null;
}

/** 任务详情（含依赖链与下游影响由前端用 deps 数据计算）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const taskId = Number.parseInt(id, 10);
  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ error: '任务 id 无效' }, { status: 400 });
  }
  const task = await loadTask(taskId);
  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  const courseId = await getTaskCourseId(taskId);
  if (courseId === null) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  return NextResponse.json({ task });
}

/** 改标题、工时、截止、优先级、交付物类型（队长）。 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const taskId = Number.parseInt(id, 10);
  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ error: '任务 id 无效' }, { status: 400 });
  }
  const task = await loadTask(taskId);
  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  const courseId = await getTaskCourseId(taskId);
  if (courseId === null) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain']);
  if (!auth.ok) return auth.response;

  const parsed = updateTaskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }
  const updated = await updateTask(taskId, parsed.data);
  return NextResponse.json({ task: updated });
}

/** 删除任务（队长；自动清理依赖边并提示影响）。 */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const taskId = Number.parseInt(id, 10);
  if (!Number.isFinite(taskId)) {
    return NextResponse.json({ error: '任务 id 无效' }, { status: 400 });
  }
  const task = await loadTask(taskId);
  if (!task) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }

  const courseId = await getTaskCourseId(taskId);
  if (courseId === null) {
    return NextResponse.json({ error: '任务不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain']);
  if (!auth.ok) return auth.response;

  await deleteTask(taskId);
  return NextResponse.json({ ok: true });
}

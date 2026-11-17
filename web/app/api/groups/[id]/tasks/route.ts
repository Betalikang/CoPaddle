import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { assertGroupAccess } from '@/lib/auth/task-access';
import { db } from '@/lib/db/drizzle';
import { groups } from '@/lib/db/schema';
import { createTask } from '@/lib/services/tasks';
import { createTaskSchema } from '@/lib/validation/tasks';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

/**
 * 手工新建单个任务（规格书 S4.10：AI 不可用时的降级入口）。
 * 此前只有 AI 拆解这一条建任务的路径，AI 一挂就完全没法拆活——路由层的
 * 503 文案还写着「可手工创建」，但没有任何接口能承接，等于把未接线的能力
 * 包装成了已实现。这里补上真实的落库入口。
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const groupId = parseId(id);
  if (groupId === null) {
    return NextResponse.json({ error: '小组 id 无效' }, { status: 400 });
  }

  const [group] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) {
    return NextResponse.json({ error: '小组不存在' }, { status: 404 });
  }
  // 与 AI 拆解保持同一权限：教师/助教/队长（队员不能替全组拆活）
  const auth = await assertCourseRole(group.courseId, ['teacher', 'assistant', 'captain'], { write: true });
  if (!auth.ok) return auth.response;
  if (!(await assertGroupAccess(groupId, auth.user, auth.membership.role))) {
    return NextResponse.json({ error: '不属于该小组' }, { status: 403 });
  }

  const parsed = createTaskSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await createTask(groupId, auth.user.id, parsed.data);
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 });
  }
  return NextResponse.json({ task: result.task }, { status: 201 });
}
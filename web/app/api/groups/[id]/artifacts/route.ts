import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertCourseRole } from '@/lib/auth/course-access';
import { assertGroupAccess } from '@/lib/auth/task-access';
import { db } from '@/lib/db/drizzle';
import { groups, tasks } from '@/lib/db/schema';
import { createArtifact, listArtifacts } from '@/lib/services/artifacts';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  title: z.string().min(1, '标题不能为空').max(200),
  type: z.enum(['document', 'figure', 'table', 'code', 'slide', 'dataset']).optional(),
  taskId: z.number().int().positive().optional(),
  isFinalDeliverable: z.boolean().optional()
});

async function getGroupCourseId(groupId: number): Promise<number | null> {
  const [row] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  return row?.courseId ?? null;
}

/** 交付物列表（组内可读）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const groupId = parseId(id);
  if (groupId === null) {
    return NextResponse.json({ error: '小组 id 无效' }, { status: 400 });
  }

  const courseId = await getGroupCourseId(groupId);
  if (courseId === null) {
    return NextResponse.json({ error: '小组不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;
  // 组级归属：队长/队员必须是在册组员（规格书 S5，防组间 IDOR）
  if (!(await assertGroupAccess(groupId, auth.user, auth.membership.role))) {
    return NextResponse.json({ error: '不属于该小组' }, { status: 403 });
  }

  const artifacts = await listArtifacts(groupId);
  return NextResponse.json({ artifacts });
}

/** 新建交付物（组内可建）。 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const groupId = parseId(id);
  if (groupId === null) {
    return NextResponse.json({ error: '小组 id 无效' }, { status: 400 });
  }

  const courseId = await getGroupCourseId(groupId);
  if (courseId === null) {
    return NextResponse.json({ error: '小组不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member'], { write: true });
  if (!auth.ok) return auth.response;
  // 组级归属：写操作同样必须是在册组员（GET 有、POST 原来漏了 → 可跨组塞交付物）
  if (!(await assertGroupAccess(groupId, auth.user, auth.membership.role))) {
    return NextResponse.json({ error: '不属于该小组' }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  // taskId 必须挂在本组任务上
  if (parsed.data.taskId !== undefined) {
    const [task] = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, parsed.data.taskId), eq(tasks.groupId, groupId)))
      .limit(1);
    if (!task) {
      return NextResponse.json({ error: '任务不属于该小组' }, { status: 400 });
    }
  }

  const artifact = await createArtifact(groupId, auth.user.id, parsed.data);
  return NextResponse.json({ artifact }, { status: 201 });
}

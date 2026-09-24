import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { assertGroupAccess } from '@/lib/auth/task-access';
import { db } from '@/lib/db/drizzle';
import { groups } from '@/lib/db/schema';
import { generateTaskPlan } from '@/lib/services/tasks';
import { generatePlanSchema } from '@/lib/validation/tasks';

type Params = { params: Promise<{ id: string }> };

/** 生成任务计划（规格书 B-08：队长/教师触发，LLM 调用点 1）。 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const groupId = Number.parseInt(id, 10);
  if (!Number.isFinite(groupId)) {
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
  // 上传作业要求并触发拆解：教师/助教/队长均可（规格书 S5）
  const auth = await assertCourseRole(group.courseId, ['teacher', 'assistant', 'captain']);
  if (!auth.ok) return auth.response;
  // 组级归属：队长/队员必须是在册组员（规格书 S5，防组间 IDOR）
  if (!(await assertGroupAccess(groupId, auth.user, auth.membership.role))) {
    return NextResponse.json({ error: '不属于该小组' }, { status: 403 });
  }

  const parsed = generatePlanSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  const result = await generateTaskPlan(groupId, auth.user.id, parsed.data);
  if ('needConfirm' in result) {
    return NextResponse.json(
      { error: '该小组已有任务计划，重新生成将丢弃旧计划，请确认', needConfirm: true },
      { status: 409 }
    );
  }
  if ('aiUnavailable' in result) {
    // 规格书 S4.10：AI 暂不可用，提供手工创建入口
    return NextResponse.json(
      { error: `AI 暂不可用：${result.message}。可手工创建任务。`, aiUnavailable: true },
      { status: 503 }
    );
  }
  return NextResponse.json(result, { status: 201 });
}

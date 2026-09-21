import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { groups } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { analyzeConflict, getConflict } from '@/lib/services/conflicts';

type Params = { params: Promise<{ id: string }> };

/** 冲突详情（双方原文、契约依据、LLM 归因结果）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const conflictId = Number.parseInt(id, 10);
  if (!Number.isFinite(conflictId)) {
    return NextResponse.json({ error: '冲突 id 无效' }, { status: 400 });
  }

  const data = await getConflict(conflictId);
  if (!data) {
    return NextResponse.json({ error: '冲突不存在' }, { status: 404 });
  }
  const [group] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, data.conflict.groupId))
    .limit(1);
  if (!group) {
    return NextResponse.json({ error: '冲突不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(group.courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  return NextResponse.json(data);
}

const analyzeSchema = z.object({
  textA: z.string().min(1),
  textB: z.string().min(1),
  authorA: z.string().optional(),
  authorB: z.string().optional(),
  contractTerms: z
    .array(z.object({ term: z.string(), definition: z.string(), unit: z.string() }))
    .optional()
});

/** LLM 调用点 2：语义归因（队长/教师确认发起，不自动批量调用）。 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const conflictId = Number.parseInt(id, 10);
  if (!Number.isFinite(conflictId)) {
    return NextResponse.json({ error: '冲突 id 无效' }, { status: 400 });
  }

  const data = await getConflict(conflictId);
  if (!data) {
    return NextResponse.json({ error: '冲突不存在' }, { status: 404 });
  }
  const [group] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, data.conflict.groupId))
    .limit(1);
  if (!group) {
    return NextResponse.json({ error: '冲突不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(group.courseId, ['teacher', 'assistant', 'captain']);
  if (!auth.ok) return auth.response;

  const parsed = analyzeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await analyzeConflict(conflictId, parsed.data);
    if ('aiUnavailable' in result) {
      // 降级：人工判断（规格书 S4.10）
      return NextResponse.json(
        { error: `AI 暂不可用：${result.message}。可参考双方原文与契约人工判断。`, aiUnavailable: true },
        { status: 503 }
      );
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '归因失败' },
      { status: 400 }
    );
  }
}


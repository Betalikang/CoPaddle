import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { classes } from '@/lib/db/schema';
import { deleteClass, getClassCourseId, updateClass } from '@/lib/services/classes';
import { z } from 'zod';

type Params = { params: Promise<{ id: string; classId: string }> };

async function authorize(classId: number) {
  const courseId = await getClassCourseId(classId);
  if (courseId === null) {
    return { ok: false as const, response: NextResponse.json({ error: '班级不存在' }, { status: 404 }) };
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return { ok: false as const, response: auth.response };
  return { ok: true as const, courseId };
}

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  major: z.string().max(100).nullable().optional(),
  grade: z.string().max(20).nullable().optional(),
  advisor: z.string().max(50).nullable().optional()
});

/** 改班级信息（与名单管理同一套 classId）。 */
export async function PATCH(request: Request, { params }: Params) {
  const { classId: cid } = await params;
  const classId = Number.parseInt(cid, 10);
  if (!Number.isFinite(classId)) {
    return NextResponse.json({ error: '班级 id 无效' }, { status: 400 });
  }
  const auth = await authorize(classId);
  if (!auth.ok) return auth.response;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const row = await updateClass(classId, parsed.data);
    return NextResponse.json({ class: row });
  } catch {
    return NextResponse.json({ error: '班级名已存在' }, { status: 409 });
  }
}

/** 删除班级：成员回「未分班」，该班小组解除归属；有进行中小组则拒绝。 */
export async function DELETE(_request: Request, { params }: Params) {
  const { classId: cid } = await params;
  const classId = Number.parseInt(cid, 10);
  if (!Number.isFinite(classId)) {
    return NextResponse.json({ error: '班级 id 无效' }, { status: 400 });
  }
  const auth = await authorize(classId);
  if (!auth.ok) return auth.response;

  // 归属校验：必须属于本课
  const [row] = await db
    .select({ courseId: classes.courseId })
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.courseId, auth.courseId)))
    .limit(1);
  if (!row) {
    return NextResponse.json({ error: '班级不属于该课程' }, { status: 403 });
  }

  const result = await deleteClass(classId);
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

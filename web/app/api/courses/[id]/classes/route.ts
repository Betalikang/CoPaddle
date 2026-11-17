import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { classes } from '@/lib/db/schema';
import { createClass, listClasses, updateClass } from '@/lib/services/classes';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

const createSchema = z.object({
  name: z.string().min(1, '班级名不能为空').max(100),
  major: z.string().max(100).optional(),
  grade: z.string().max(20).optional(),
  advisor: z.string().max(50).optional()
});

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  major: z.string().max(100).nullable().optional(),
  grade: z.string().max(20).nullable().optional(),
  advisor: z.string().max(50).nullable().optional()
});

/**
 * 班级列表 / 新建 / 改名。
 * 班级设计与名单管理共用同一套 classId（规格书 B-03）。
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = parseId(id);
  if (courseId === null) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const rows = await listClasses(courseId);
  return NextResponse.json({ classes: rows });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = parseId(id);
  if (courseId === null) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant'], { write: true });
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const row = await createClass(courseId, parsed.data);
    return NextResponse.json({ class: row }, { status: 201 });
  } catch (err) {
    // 只有唯一键冲突才是「重名」，其他数据库错误不能一并报成 409
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: '班级名已存在' }, { status: 409 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '新建班级失败' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = parseId(id);
  if (courseId === null) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant'], { write: true });
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const classId = parseId(
    typeof body?.classId === 'number' ? String(body.classId) : (body?.classId as string | undefined)
  );
  if (classId === null) {
    return NextResponse.json({ error: '缺少 classId' }, { status: 400 });
  }

  const [owned] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.courseId, courseId)))
    .limit(1);
  if (!owned) {
    return NextResponse.json({ error: '班级不存在' }, { status: 404 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const row = await updateClass(classId, parsed.data);
    return NextResponse.json({ class: row });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json({ error: '班级名已存在' }, { status: 409 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '保存班级失败' },
      { status: 500 }
    );
  }
}

/** postgres 唯一键冲突（23505）。 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    ((err as { code?: string }).code === '23505' ||
      (err as { cause?: { code?: string } }).cause?.code === '23505')
  );
}

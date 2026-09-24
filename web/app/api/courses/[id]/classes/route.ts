import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { classes } from '@/lib/db/schema';
import { createClass, listClasses, updateClass } from '@/lib/services/classes';

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
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const rows = await listClasses(courseId);
  return NextResponse.json({ classes: rows });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const row = await createClass(courseId, parsed.data);
    return NextResponse.json({ class: row }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '班级名已存在' }, { status: 409 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const classId = Number.parseInt(String(body?.classId ?? ''), 10);
  if (!Number.isFinite(classId)) {
    return NextResponse.json({ error: '缺少 classId' }, { status: 400 });
  }

  const [owned] = await db
    .select({ id: classes.id })
    .from(classes)
    .where(eq(classes.id, classId))
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
  } catch {
    return NextResponse.json({ error: '班级名已存在' }, { status: 409 });
  }
}

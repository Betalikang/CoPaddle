import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { importEnrollmentsCsv } from '@/lib/services/enrollments';
import { importEnrollmentsSchema } from '@/lib/validation/courses';

type Params = { params: Promise<{ id: string }> };

/** CSV 批量导入：表头 name,email,student_no,class_name；返回逐行校验报告。 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const parsed = importEnrollmentsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数错误', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const report = await importEnrollmentsCsv(courseId, parsed.data.csv);
  return NextResponse.json({ report });
}

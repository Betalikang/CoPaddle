import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { addEnrollment, listEnrollments } from '@/lib/services/enrollments';
import { addEnrollmentSchema } from '@/lib/validation/courses';

type Params = { params: Promise<{ id: string }> };

// 名单管理：教师/助教；队员只能看到本组成员（规格书 S5，本路由不向队员开放）
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const enrollments = await listEnrollments(courseId);
  return NextResponse.json({ enrollments });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const parsed = addEnrollmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数错误', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const result = await addEnrollment(courseId, parsed.data);
  return NextResponse.json(
    { userId: result.userId, membership: result.membership, created: result.created },
    { status: result.created ? 201 : 200 }
  );
}

import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getUser } from '@/lib/db/queries';
import { getCourseForUser, updateCourse } from '@/lib/services/courses';
import { updateCourseSchema } from '@/lib/validation/courses';

type Params = { params: Promise<{ id: string }> };

async function parseCourseId(params: Params['params']) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  return Number.isFinite(courseId) ? courseId : null;
}

export async function GET(_request: Request, { params }: Params) {
  const courseId = await parseCourseId(params);
  if (!courseId) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const data = await getCourseForUser(courseId, user.id);
  if (!data) {
    return NextResponse.json({ error: '课程不存在或无权访问' }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function PATCH(request: Request, { params }: Params) {
  const courseId = await parseCourseId(params);
  if (!courseId) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  // 基本信息：仅教师/助教可改（规格书 S5）
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const parsed = updateCourseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数错误', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const course = await updateCourse(courseId, parsed.data);
  return NextResponse.json({ course });
}

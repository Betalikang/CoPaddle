import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getUser } from '@/lib/db/queries';
import { EvidenceWeightError, getCourseForUser, updateCourseSettings } from '@/lib/services/courses';
import { updateSettingsSchema } from '@/lib/validation/courses';

type Params = { params: Promise<{ id: string }> };

// 读设置：组内成员可读（权重与阈值对全课程透明）；改设置：仅教师/助教
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
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
  return NextResponse.json({ settings: data.settings });
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const parsed = updateSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数错误', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  try {
    const settings = await updateCourseSettings(courseId, parsed.data);
    return NextResponse.json({ settings });
  } catch (err) {
    if (err instanceof EvidenceWeightError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

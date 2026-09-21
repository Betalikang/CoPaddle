import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getMySkillCard, upsertSkillCard } from '@/lib/services/skill-cards';
import { skillCardSchema } from '@/lib/validation/courses';

type Params = { params: Promise<{ id: string }> };

// 我的技能卡：本人可读写（规格书 B-04）
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const card = await getMySkillCard(courseId, auth.user.id);
  return NextResponse.json({ card });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const parsed = skillCardSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数错误', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const card = await upsertSkillCard(courseId, auth.user.id, parsed.data);
  return NextResponse.json({ card }, { status: 201 });
}

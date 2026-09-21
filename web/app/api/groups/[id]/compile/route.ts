import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { groups } from '@/lib/db/schema';
import { compileFinal } from '@/lib/services/artifacts';

type Params = { params: Promise<{ id: string }> };

/** 汇编终稿：把组内交付物按模板合成一份完整文档（队长）。 */
export async function POST(_request: Request, { params }: Params) {
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
  const auth = await assertCourseRole(group.courseId, ['teacher', 'assistant', 'captain']);
  if (!auth.ok) return auth.response;

  try {
    const final = await compileFinal(groupId, auth.user.id);
    return NextResponse.json({ artifact: final }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '汇编失败' },
      { status: 400 }
    );
  }
}

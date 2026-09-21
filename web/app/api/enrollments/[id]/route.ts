import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { courseMemberships } from '@/lib/db/schema';
import { courseRoleSchema } from '@/lib/validation/courses';

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  role: courseRoleSchema.optional(),
  classId: z.number().int().nullable().optional(),
  status: z.enum(['active', 'dropped']).optional()
});

/** 改名单成员的班级/角色/状态（教师/助教）。 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const membershipId = Number.parseInt(id, 10);
  if (!Number.isFinite(membershipId)) {
    return NextResponse.json({ error: 'membership id 无效' }, { status: 400 });
  }

  // 先取 membership 才知道属于哪门课
  const [existing] = await db
    .select()
    .from(courseMemberships)
    .where(eq(courseMemberships.id, membershipId))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: '成员不存在' }, { status: 404 });
  }

  const auth = await assertCourseRole(existing.courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数错误', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const [updated] = await db
    .update(courseMemberships)
    .set(parsed.data)
    .where(eq(courseMemberships.id, membershipId))
    .returning();

  return NextResponse.json({ membership: updated });
}

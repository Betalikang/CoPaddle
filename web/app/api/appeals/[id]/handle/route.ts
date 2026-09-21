import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getSnapshotCourseId, handleAppeal } from '@/lib/services/contributions';
import { db } from '@/lib/db/drizzle';
import { attributionAppeals } from '@/lib/db/schema';

type Params = { params: Promise<{ id: string }> };

const handleSchema = z.object({
  status: z.enum(['accepted', 'rejected', 'partially_accepted', 'reviewing']),
  resultNote: z.string().min(1, '必须填写处理理由').max(2000)
});

/** 教师处理申诉（必须填理由；规格书 S4.1）。 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const appealId = Number.parseInt(id, 10);
  if (!Number.isFinite(appealId)) {
    return NextResponse.json({ error: '申诉 id 无效' }, { status: 400 });
  }

  // 归属：申诉 → snapshot → 课程，仅教师可处理
  const [appeal] = await db
    .select()
    .from(attributionAppeals)
    .where(eq(attributionAppeals.id, appealId))
    .limit(1);
  if (!appeal) {
    return NextResponse.json({ error: '申诉不存在' }, { status: 404 });
  }
  const courseId = await getSnapshotCourseId(appeal.snapshotId);
  if (courseId === null) {
    return NextResponse.json({ error: '申诉不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher']);
  if (!auth.ok) return auth.response;

  const parsed = handleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误', issues: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await handleAppeal(appealId, auth.user.id, parsed.data);
  return NextResponse.json({ appeal: updated });
}

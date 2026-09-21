import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { getUser } from '@/lib/db/queries';
import { groups } from '@/lib/db/schema';
import { acceptContract, getContract, publishContract } from '@/lib/services/tasks';

type Params = { params: Promise<{ id: string }> };

async function getGroupCourseId(groupId: number): Promise<number | null> {
  const [row] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  return row?.courseId ?? null;
}

/** 当前生效契约 + 历史版本 + 签署状态（组内可读）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const groupId = Number.parseInt(id, 10);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: '小组 id 无效' }, { status: 400 });
  }

  const courseId = await getGroupCourseId(groupId);
  if (courseId === null) {
    return NextResponse.json({ error: '小组不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const data = await getContract(groupId);
  return NextResponse.json(data ?? { latest: null, versions: [], glossary: [], acceptances: [] });
}

/** 发布版本（队长）：通知全体成员确认。 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const groupId = Number.parseInt(id, 10);
  if (!Number.isFinite(groupId)) {
    return NextResponse.json({ error: '小组 id 无效' }, { status: 400 });
  }

  const courseId = await getGroupCourseId(groupId);
  if (courseId === null) {
    return NextResponse.json({ error: '小组不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain']);
  if (!auth.ok) return auth.response;

  const contract = await publishContract(groupId, auth.user.id);
  if (!contract) {
    return NextResponse.json({ error: '尚无契约可发布' }, { status: 404 });
  }
  return NextResponse.json({ contract });
}

const acceptSchema = z.object({ contractId: z.number().int().positive() });

/** 成员确认签署（本人）。 */
export async function PUT(request: Request, { params }: Params) {
  void (await params).id;
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const parsed = acceptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误' }, { status: 400 });
  }
  await acceptContract(parsed.data.contractId, user.id);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertCourseRole } from '@/lib/auth/course-access';
import { assertGroupAccess } from '@/lib/auth/task-access';
import { db } from '@/lib/db/drizzle';
import { contracts, groups } from '@/lib/db/schema';
import { acceptContract, getContract, publishContract } from '@/lib/services/tasks';
import { parseId } from '@/lib/api/params';

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
  const groupId = parseId(id);
  if (groupId === null) {
    return NextResponse.json({ error: '小组 id 无效' }, { status: 400 });
  }

  const courseId = await getGroupCourseId(groupId);
  if (courseId === null) {
    return NextResponse.json({ error: '小组不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;
  // 组级归属：队长/队员必须是在册组员（规格书 S5，防组间 IDOR）
  if (!(await assertGroupAccess(groupId, auth.user, auth.membership.role))) {
    return NextResponse.json({ error: '不属于该小组' }, { status: 403 });
  }

  const data = await getContract(groupId);
  return NextResponse.json(data ?? { latest: null, versions: [], glossary: [], acceptances: [] });
}

/** 发布版本（队长/教师）：通知全体成员确认。 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const groupId = parseId(id);
  if (groupId === null) {
    return NextResponse.json({ error: '小组 id 无效' }, { status: 400 });
  }

  const courseId = await getGroupCourseId(groupId);
  if (courseId === null) {
    return NextResponse.json({ error: '小组不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain'], { write: true });
  if (!auth.ok) return auth.response;
  // 队长只能发布本组契约（教师/助教可跨组）
  if (!(await assertGroupAccess(groupId, auth.user, auth.membership.role))) {
    return NextResponse.json({ error: '不属于该小组' }, { status: 403 });
  }

  const contract = await publishContract(groupId, auth.user.id);
  if (!contract) {
    return NextResponse.json({ error: '尚无契约可发布' }, { status: 404 });
  }
  return NextResponse.json({ contract });
}

const acceptSchema = z.object({ contractId: z.number().int().positive() });

/** 成员确认签署（本人，且只能签本组已发布的契约）。 */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const groupId = parseId(id);
  if (groupId === null) {
    return NextResponse.json({ error: '小组 id 无效' }, { status: 400 });
  }

  const parsed = acceptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误' }, { status: 400 });
  }

  const courseId = await getGroupCourseId(groupId);
  if (courseId === null) {
    return NextResponse.json({ error: '小组不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member'], { write: true });
  if (!auth.ok) return auth.response;
  if (!(await assertGroupAccess(groupId, auth.user, auth.membership.role))) {
    return NextResponse.json({ error: '不属于该小组' }, { status: 403 });
  }

  // 契约必须属于路径上的小组，且已发布（草稿不可签）
  const [contract] = await db
    .select({ id: contracts.id, publishedAt: contracts.publishedAt })
    .from(contracts)
    .where(and(eq(contracts.id, parsed.data.contractId), eq(contracts.groupId, groupId)))
    .limit(1);
  if (!contract) {
    return NextResponse.json({ error: '契约不存在' }, { status: 404 });
  }
  if (!contract.publishedAt) {
    return NextResponse.json({ error: '契约尚未发布' }, { status: 400 });
  }

  await acceptContract(contract.id, auth.user.id);
  return NextResponse.json({ ok: true });
}

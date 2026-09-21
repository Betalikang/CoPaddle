import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { groups } from '@/lib/db/schema';
import { AlgoServiceError } from '@/lib/algo/client';
import { computeGroupContributions, getGroupLedger } from '@/lib/services/contributions';

type Params = { params: Promise<{ id: string }> };

async function getGroupCourseId(groupId: number): Promise<number | null> {
  const [row] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  return row?.courseId ?? null;
}

/** 全组账本（组内可读；他人区间默认不可见由前端按权限裁剪，规格书 S5）。 */
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

  const ledger = await getGroupLedger(groupId);
  return NextResponse.json(ledger ?? { snapshotAt: null, memberCount: 0, entries: [] });
}

/** 触发贡献计算（队长；提交终稿后也应自动触发，S6 期接定时任务）。 */
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

  try {
    const result = await computeGroupContributions(groupId);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof AlgoServiceError) {
      return NextResponse.json({ error: `算法服务不可用：${err.message}` }, { status: 503 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '计算失败' },
      { status: 400 }
    );
  }
}

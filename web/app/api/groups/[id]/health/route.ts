import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { assertCourseRole } from '@/lib/auth/course-access';
import { assertGroupAccess, guardGroup } from '@/lib/auth/task-access';
import { db } from '@/lib/db/drizzle';
import { groups } from '@/lib/db/schema';
import { computeGroupHealth, describeSnapshotFreshness, getGroupHealth } from '@/lib/services/health';
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

/** 小组健康度：最新快照（无则现场计算）。组内可读。 */
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

  const { latest } = await getGroupHealth(groupId);
  if (latest) {
    // 快照是「上次重算那一刻」的值，不是实时健康度。带上新鲜度，
    // 让页面能说清「这份数据是 3 天前算的」，而不是当成现在的样子展示。
    const freshness = describeSnapshotFreshness(latest.snapshotAt);
    return NextResponse.json({
      snapshot: latest,
      computed: false,
      snapshotAgeHours: freshness.ageHours,
      freshness: freshness.state
    });
  }
  const { snapshot } = await computeGroupHealth(groupId);
  return NextResponse.json({
    snapshot,
    computed: true,
    snapshotAgeHours: 0,
    freshness: 'fresh' as const
  });
}

/** 强制重算健康度（队长/教师）。 */
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
  // 组级归属：队长只能重算自己组（GET 有、POST 原来漏了 → 可向别组写快照）
  const denied = await guardGroup(groupId, auth);
  if (denied) return denied;

  const { snapshot, detail } = await computeGroupHealth(groupId);
  return NextResponse.json({ snapshot, detail });
}

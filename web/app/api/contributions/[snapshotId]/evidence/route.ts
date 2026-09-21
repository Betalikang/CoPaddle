import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getSnapshotCourseId, getSnapshotEvidence } from '@/lib/services/contributions';

type Params = { params: Promise<{ snapshotId: string }> };

/** 证据下钻（规格书 P-19 杀手锏）：结论对应的全部 evidence_items 与原始引用。 */
export async function GET(_request: Request, { params }: Params) {
  const { snapshotId } = await params;
  const id = Number.parseInt(snapshotId, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: '快照 id 无效' }, { status: 400 });
  }

  const courseId = await getSnapshotCourseId(id);
  if (courseId === null) {
    return NextResponse.json({ error: '账本不存在' }, { status: 404 });
  }
  // 组内可见自己的证据明细；教师/助教看全部（规格书 S5：防止互相翻旧账）
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const data = await getSnapshotEvidence(id);
  if (!data) {
    return NextResponse.json({ error: '账本不存在' }, { status: 404 });
  }

  // 队员只能看自己的证据明细
  if (auth.membership.role === 'member' && data.snapshot.userId !== auth.user.id) {
    return NextResponse.json({ error: '只能查看自己的证据明细' }, { status: 403 });
  }

  return NextResponse.json(data);
}

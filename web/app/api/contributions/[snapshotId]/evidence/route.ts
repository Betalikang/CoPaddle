import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { isGroupMember } from '@/lib/auth/task-access';
import { getSnapshotCourseId, getSnapshotEvidence } from '@/lib/services/contributions';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ snapshotId: string }> };

/** 证据下钻（规格书 P-19 杀手锏）：结论对应的全部 evidence_items 与原始引用。 */
export async function GET(_request: Request, { params }: Params) {
  const { snapshotId } = await params;
  const id = parseId(snapshotId);
  if (id === null) {
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

  // 队员只能看自己的证据明细；队长只能看本组的（原来只判 'member'，
  // 任意组的队长都能看别组成员的证据原文）
  const role = auth.membership.role;
  const privileged = role === 'teacher' || role === 'assistant';
  if (!privileged && data.snapshot.userId !== auth.user.id) {
    const sameGroup = await isGroupMember(data.snapshot.groupId, auth.user.id);
    if (!sameGroup) {
      return NextResponse.json({ error: '只能查看自己的证据明细' }, { status: 403 });
    }
  }

  return NextResponse.json(data);
}

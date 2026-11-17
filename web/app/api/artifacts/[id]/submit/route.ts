import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getArtifactGroupId, guardGroup } from '@/lib/auth/task-access';
import { getArtifactCourseId, submitFinal } from '@/lib/services/artifacts';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

/** 提交终稿至教师（提交后段落归属冻结，规格书 S4.1）。 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const artifactId = parseId(id);
  if (artifactId === null) {
    return NextResponse.json({ error: '交付物 id 无效' }, { status: 400 });
  }

  const courseId = await getArtifactCourseId(artifactId);
  if (courseId === null) {
    return NextResponse.json({ error: '交付物不存在' }, { status: 404 });
  }
  // 提交终稿：仅教师/助教/队长
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain'], { write: true });
  if (!auth.ok) return auth.response;
  const groupId = await getArtifactGroupId(artifactId);
  if (groupId === null) {
    return NextResponse.json({ error: '交付物不存在' }, { status: 404 });
  }
  const denied = await guardGroup(groupId, auth);
  if (denied) return denied;

  const artifact = await submitFinal(artifactId);
  return NextResponse.json({ artifact });
}

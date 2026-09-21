import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getArtifact, getArtifactCourseId } from '@/lib/services/artifacts';

type Params = { params: Promise<{ id: string }> };

/** 交付物详情：当前版本 + 各成员字数占比（溯源入口）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const artifactId = Number.parseInt(id, 10);
  if (!Number.isFinite(artifactId)) {
    return NextResponse.json({ error: '交付物 id 无效' }, { status: 400 });
  }

  const courseId = await getArtifactCourseId(artifactId);
  if (courseId === null) {
    return NextResponse.json({ error: '交付物不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const data = await getArtifact(artifactId);
  if (!data) {
    return NextResponse.json({ error: '交付物不存在' }, { status: 404 });
  }
  return NextResponse.json(data);
}

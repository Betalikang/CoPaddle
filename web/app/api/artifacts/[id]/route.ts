import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getArtifactGroupId, guardGroup } from '@/lib/auth/task-access';
import { getArtifact, getArtifactCourseId } from '@/lib/services/artifacts';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

/** 交付物详情：当前版本 + 各成员字数占比（溯源入口）。 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const artifactId = parseId(id);
  if (artifactId === null) {
    return NextResponse.json({ error: '交付物 id 无效' }, { status: 400 });
  }

  const courseId = await getArtifactCourseId(artifactId);
  if (courseId === null) {
    return NextResponse.json({ error: '交付物不存在' }, { status: 404 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;
  // 组级归属：队长/队员只能看本组交付物（防组间 IDOR）
  const groupId = await getArtifactGroupId(artifactId);
  if (groupId === null) {
    return NextResponse.json({ error: '交付物不存在' }, { status: 404 });
  }
  const denied = await guardGroup(groupId, auth);
  if (denied) return denied;

  const data = await getArtifact(artifactId);
  if (!data) {
    return NextResponse.json({ error: '交付物不存在' }, { status: 404 });
  }

  // Map 经 JSON 序列化会变成 {}，这里显式转成 { userId: 字数 } 的普通对象
  const { authorStats, ...rest } = data;
  return NextResponse.json({
    ...rest,
    authorStats: {
      totalWords: authorStats.totalWords,
      byAuthor: Object.fromEntries(authorStats.byAuthor) as Record<string, number>
    }
  });
}

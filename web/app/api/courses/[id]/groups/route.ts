import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { listGroups } from '@/lib/services/grouping';

type Params = { params: Promise<{ id: string }> };

/**
 * 小组列表（含成员与班级归属）。
 * 支持 ?classId= 过滤；小组管理挂在班级下（班级设计与名单管理一致）。
 */
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = Number.parseInt(id, 10);
  if (!Number.isFinite(courseId)) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const raw = url.searchParams.get('classId');
  let classId: number | null | undefined;
  if (raw === 'none') classId = null;
  else if (raw !== null) {
    const n = Number.parseInt(raw, 10);
    classId = Number.isFinite(n) ? n : undefined;
  }

  const groups = await listGroups(courseId, classId);
  return NextResponse.json({ groups });
}

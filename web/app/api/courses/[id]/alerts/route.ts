import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getCourseAlertSummary } from '@/lib/services/health';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

/**
 * 预警中心：有待处理诊断的小组（按严重度排序）。
 *
 * 同时返回 coverage：预警是「快照说有问题」的组，没算过快照的组不会出现。
 * 只给列表的话，全班都没重算时页面显示「一切正常」——那是误报的安全感。
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = parseId(id);
  if (courseId === null) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const { alerts, coverage } = await getCourseAlertSummary(courseId);
  return NextResponse.json({ alerts, coverage });
}
import { NextResponse } from 'next/server';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getCourseAlertSummary } from '@/lib/services/health';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

/**
 * 全班小组健康度总览（教师端热力图）。
 *
 * 顺带返回 coverage：健康度是快照，不是实时值。「没有任何预警」有两种完全不同的
 * 含义——真的健康，或者从来没算过。没有 coverage 的话页面无法区分，教师会把
 * 「全班一次都没重算」读成「一切正常」。
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const courseId = parseId(id);
  if (courseId === null) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant', 'captain', 'member']);
  if (!auth.ok) return auth.response;

  const { groups, coverage } = await getCourseAlertSummary(courseId);
  return NextResponse.json({ groups, coverage });
}
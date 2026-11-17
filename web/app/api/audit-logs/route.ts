import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { courseMemberships } from '@/lib/db/schema';
import { listAuditLogs } from '@/lib/services/notifications';

/**
 * 审计流水（教师/助教：按对象与时间筛选）。
 *
 * 只返回「我教的课程」相关的记录：audit_logs 没有 course_id，靠 target 反查
 * 课程；反查不到的（老数据）退回按「操作人是否在我的课上」判断。
 */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const targetType = new URL(request.url).searchParams.get('targetType') ?? undefined;

  const myCourses = await db
    .select({ id: courseMemberships.courseId })
    .from(courseMemberships)
    .where(
      and(
        eq(courseMemberships.userId, user.id),
        inArray(courseMemberships.role, ['teacher', 'assistant'])
      )
    );
  const courseIds = myCourses.map((c) => c.id);
  if (courseIds.length === 0) {
    // 助教/学生不给看全站审计（规格 S5：审计仅教师侧）
    return NextResponse.json({ logs: [] });
  }

  // 这些课的所有成员：用于「目标解析不到」时的兜底归属判断
  const members = await db
    .select({ userId: courseMemberships.userId })
    .from(courseMemberships)
    .where(inArray(courseMemberships.courseId, courseIds));
  const actorIds = [...new Set(members.map((m) => m.userId))];

  const logs = await listAuditLogs({ targetType, courseIds, actorIds });
  return NextResponse.json({ logs });
}

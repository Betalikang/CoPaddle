import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { courseMemberships } from '@/lib/db/schema';
import { listAiCallLogs } from '@/lib/services/notifications';

/** AI 调用与成本监控（教师/助教：只统计自己课程）。 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
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
    return NextResponse.json({ logs: [], totals: { calls: 0, prompt: 0, completion: 0 } });
  }

  // ai_call_logs 自带 course_id，直接按课程过滤（原来完全没过滤 → 全站可见）
  const logs = await listAiCallLogs(100, courseIds);
  const totals = logs.reduce(
    (acc, l) => ({
      calls: acc.calls + 1,
      prompt: acc.prompt + (l.promptTokens ?? 0),
      completion: acc.completion + (l.completionTokens ?? 0)
    }),
    { calls: 0, prompt: 0, completion: 0 }
  );
  return NextResponse.json({ logs, totals });
}

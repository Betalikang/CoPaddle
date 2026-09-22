import { NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { courses } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { listAiCallLogs } from '@/lib/services/notifications';

/** AI 调用与成本监控（教师）。 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const myCourses = await db.select({ id: courses.id }).from(courses).where(inArray(courses.teacherId, [user.id]));
  if (myCourses.length === 0) {
    return NextResponse.json({ logs: [] });
  }
  const logs = await listAiCallLogs(100);
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

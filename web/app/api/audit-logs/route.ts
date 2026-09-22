import { NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { db } from '@/lib/db/drizzle';
import { courses } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { listAuditLogs } from '@/lib/services/notifications';

/** 审计流水（教师：按对象与时间筛选）。 */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const targetType = new URL(request.url).searchParams.get('targetType') ?? undefined;

  // 仅教师可看：取我教的课程 id 做归属过滤（简化：教师本人审计全集）
  const myCourses = await db.select({ id: courses.id }).from(courses).where(inArray(courses.teacherId, [user.id]));
  if (myCourses.length === 0) {
    // 助教也不给看（规格 S5：审计仅教师）
    return NextResponse.json({ logs: [] });
  }
  const logs = await listAuditLogs({ targetType });
  return NextResponse.json({ logs });
}

import { NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';

/** 当前用户 + 全部课程内角色上下文（规格书 B-01）。 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const { listMyCourses } = await import('@/lib/services/courses');
  const courses = await listMyCourses(user.id);
  return NextResponse.json({
    user,
    courses: courses.map((c) => ({ id: c.id, name: c.name, role: c.myRole }))
  });
}

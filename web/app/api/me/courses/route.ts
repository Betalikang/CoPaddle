import { NextResponse } from 'next/server';
import { listMyCourses } from '@/lib/services/courses';
import { getUser } from '@/lib/db/queries';

/** 我参与的课程，含我在每门课的角色（规格书 B-01）。 */
export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const courses = await listMyCourses(user.id);
  return NextResponse.json({ courses });
}

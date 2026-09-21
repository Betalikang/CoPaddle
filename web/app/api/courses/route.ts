import { NextResponse } from 'next/server';
import { getUser } from '@/lib/db/queries';
import { createCourse, listMyCourses } from '@/lib/services/courses';
import { createCourseSchema } from '@/lib/validation/courses';

export async function GET() {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }
  const courses = await listMyCourses(user.id);
  return NextResponse.json({ courses });
}

export async function POST(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const parsed = createCourseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数错误', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const course = await createCourse(parsed.data, user.id);
  return NextResponse.json({ course }, { status: 201 });
}

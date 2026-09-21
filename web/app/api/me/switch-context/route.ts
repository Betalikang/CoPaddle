import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCourseContextFor, setCourseContextCookie } from '@/lib/course-context';
import { getUser } from '@/lib/db/queries';

const switchContextSchema = z.object({
  courseId: z.number().int().positive()
});

/** 切换当前课程上下文（角色随之切换）。仅校验「是否属于该课程」。 */
export async function POST(request: Request) {
  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const parsed = switchContextSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: '参数错误' }, { status: 400 });
  }

  const ctx = await getCourseContextFor(parsed.data.courseId);
  if (!ctx) {
    return NextResponse.json({ error: '不属于该课程' }, { status: 403 });
  }

  await setCourseContextCookie(ctx.courseId);
  return NextResponse.json({ courseId: ctx.courseId, role: ctx.role });
}

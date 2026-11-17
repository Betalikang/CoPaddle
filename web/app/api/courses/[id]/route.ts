import { NextResponse } from 'next/server';
import { parseId } from '@/lib/api/params';
import { assertCourseRole } from '@/lib/auth/course-access';
import { getUser } from '@/lib/db/queries';
import { getCourseForUser, updateCourse } from '@/lib/services/courses';
import { updateCourseSchema } from '@/lib/validation/courses';

type Params = { params: Promise<{ id: string }> };

async function parseCourseId(params: Params['params']) {
  const { id } = await params;
  return parseId(id);
}

export async function GET(_request: Request, { params }: Params) {
  const courseId = await parseCourseId(params);
  if (!courseId) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  const user = await getUser();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const data = await getCourseForUser(courseId, user.id);
  if (!data) {
    return NextResponse.json({ error: '课程不存在或无权访问' }, { status: 404 });
  }
  return NextResponse.json(data);
}

export async function PATCH(request: Request, { params }: Params) {
  const courseId = await parseCourseId(params);
  if (!courseId) {
    return NextResponse.json({ error: '课程 id 无效' }, { status: 400 });
  }

  // 基本信息：仅教师/助教可改（规格书 S5）。
  // 这里不能加 { write: true }：改 status 正是「取消归档」的入口，
  // 若归档课程连自己都被只读挡住，就没有任何办法把它改回进行中了。
  // 归档后的具体业务写入（设置、分组、任务…）由各自路由的 write 守卫拦住。
  const auth = await assertCourseRole(courseId, ['teacher', 'assistant']);
  if (!auth.ok) return auth.response;

  const parsed = updateCourseSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数错误', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const course = await updateCourse(courseId, parsed.data);
  // 课程在鉴权后可能已被删除：按业务语义回 404，不要变成 500
  if (!course) {
    return NextResponse.json({ error: '课程不存在' }, { status: 404 });
  }
  return NextResponse.json({ course });
}

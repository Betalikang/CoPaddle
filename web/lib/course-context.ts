import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { db } from './db/drizzle';
import { CourseMembership, CourseRole, courseMemberships } from './db/schema';
import { getUser } from './db/queries';

/**
 * 课程级角色上下文。
 *
 * 规格书 S1 建模红线：角色是课程级的，不能放 users 表。
 * 当前课程上下文只存 courseId（cookie），角色每次都从 course_memberships 现查——
 * cookie 只用于「选哪门课」，永不作为权限依据（规格书 S2 安全底线）。
 */

const CONTEXT_COOKIE = 'current_course_id';

export type CourseContext = {
  courseId: number;
  role: CourseRole;
  membership: CourseMembership;
};

export async function setCourseContextCookie(courseId: number) {
  (await cookies()).set(CONTEXT_COOKIE, String(courseId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    maxAge: 60 * 60 * 24 * 30
  });
}

export async function getCurrentCourseId(): Promise<number | null> {
  const raw = (await cookies()).get(CONTEXT_COOKIE)?.value;
  if (!raw) return null;
  const id = Number.parseInt(raw, 10);
  return Number.isFinite(id) ? id : null;
}

/** 按当前 cookie 选中的课程取上下文；无会话/未加入/已退出返回 null。 */
export async function getCourseContext(): Promise<CourseContext | null> {
  const courseId = await getCurrentCourseId();
  if (!courseId) return null;
  return getCourseContextFor(courseId);
}

/** 取某课程的上下文（每次现查 membership）。 */
export async function getCourseContextFor(courseId: number): Promise<CourseContext | null> {
  const user = await getUser();
  if (!user) return null;

  const [membership] = await db
    .select()
    .from(courseMemberships)
    .where(
      and(
        eq(courseMemberships.courseId, courseId),
        eq(courseMemberships.userId, user.id),
        eq(courseMemberships.status, 'active')
      )
    )
    .limit(1);

  if (!membership) return null;
  return { courseId, role: membership.role as CourseRole, membership };
}

import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '../db/drizzle';
import { CourseMembership, CourseRole, courseMemberships } from '../db/schema';
import { getUser } from '../db/queries';
import type { User } from '../db/schema';

/**
 * API 层的课程权限断言（规格书 S2 安全底线）：
 * 所有权限判定在服务端完成，逐次校验课程归属；前端隐藏按钮只是体验优化。
 */

export type CourseAuth =
  | { ok: true; user: User; membership: CourseMembership }
  | { ok: false; response: NextResponse };

export async function assertCourseRole(
  courseId: number,
  allowed: CourseRole[]
): Promise<CourseAuth> {
  const user = await getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: '未登录' }, { status: 401 })
    };
  }

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

  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json({ error: '不属于该课程' }, { status: 403 })
    };
  }

  if (!allowed.includes(membership.role as CourseRole)) {
    return {
      ok: false,
      response: NextResponse.json({ error: '角色权限不足' }, { status: 403 })
    };
  }

  return { ok: true, user, membership };
}

/** 便捷：教师/助教权（等同教师权限但不可删课与终审，规格书 S5）。 */
export function teacherSideRoles(): CourseRole[] {
  return ['teacher', 'assistant'];
}

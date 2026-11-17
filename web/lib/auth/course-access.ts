import { and, eq, isNull } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '../db/drizzle';
import { CourseMembership, CourseRole, courseMemberships, courses } from '../db/schema';
import { getUser } from '../db/queries';
import type { User } from '../db/schema';

/**
 * API 层的课程权限断言（规格书 S2 安全底线）：
 * 所有权限判定在服务端完成，逐次校验课程归属；前端隐藏按钮只是体验优化。
 */

export type CourseAuth =
  | { ok: true; user: User; membership: CourseMembership }
  | { ok: false; response: NextResponse };

export type CourseAuthOptions = {
  /**
   * 写操作传 true：归档课程（courses.status='archived'）一律拒绝写入。
   *
   * schema.ts:106 从建表起就写着「archived 只读」，但此前没有任何 API 强制它——
   * 归档只是列表上的一个标签，教师归档后仍能改设置、重跑分组、发布互评轮次。
   * 读接口不受影响（归档课程的名单、成绩、复盘仍要能看）。
   */
  write?: boolean;
};

export async function assertCourseRole(
  courseId: number,
  allowed: CourseRole[],
  options: CourseAuthOptions = {}
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

  if (options.write) {
    const [course] = await db
      .select({ status: courses.status })
      .from(courses)
      .where(and(eq(courses.id, courseId), isNull(courses.deletedAt)))
      .limit(1);

    if (!course) {
      return {
        ok: false,
        response: NextResponse.json({ error: '课程不存在' }, { status: 404 })
      };
    }

    if (course.status === 'archived') {
      return {
        ok: false,
        response: NextResponse.json(
          { error: '课程已归档，只读。如需继续操作，请先把它改回进行中。' },
          { status: 409 }
        )
      };
    }
  }

  return { ok: true, user, membership };
}

/** 便捷：教师/助教权（等同教师权限但不可删课与终审，规格书 S5）。 */
export function teacherSideRoles(): CourseRole[] {
  return ['teacher', 'assistant'];
}

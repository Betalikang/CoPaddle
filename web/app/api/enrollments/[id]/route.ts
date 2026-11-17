import { NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { assertCourseRole } from '@/lib/auth/course-access';
import { db } from '@/lib/db/drizzle';
import { classes, courseMemberships, groupMembers, groups } from '@/lib/db/schema';
import type { CourseRole } from '@/lib/db/schema';
import { courseRoleSchema } from '@/lib/validation/courses';
import { parseId } from '@/lib/api/params';

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  role: courseRoleSchema.optional(),
  classId: z.number().int().nullable().optional(),
  status: z.enum(['active', 'dropped']).optional()
});

/**
 * 改名单成员的班级/角色/状态（教师/助教）。
 * 队长指派（规格书 P-05 理想链路）：教师在此把学生设为队长，该学生用自己的
 * 账号登录即获得队长权限。课程角色 / groups.captain_id / group_members.duty
 * 三处保持一致；每组仅一名队长，顶替时旧队长自动降回队员。
 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const membershipId = parseId(id);
  if (membershipId === null) {
    return NextResponse.json({ error: 'membership id 无效' }, { status: 400 });
  }

  // 先取 membership 才知道属于哪门课
  const [existing] = await db
    .select()
    .from(courseMemberships)
    .where(eq(courseMemberships.id, membershipId))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: '成员不存在' }, { status: 404 });
  }

  const auth = await assertCourseRole(existing.courseId, ['teacher', 'assistant'], { write: true });
  if (!auth.ok) return auth.response;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: '参数错误', issues: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const next = parsed.data;

  // zod 会剥掉未知键：空 patch 走到 db.update().set({}) 会抛
  // 「No values to set」变成 500，这里显式拒绝。
  if (Object.keys(next).length === 0) {
    return NextResponse.json({ error: '没有需要修改的字段' }, { status: 400 });
  }

  const callerRole = auth.membership.role as CourseRole;
  const isSelf = existing.userId === auth.membership.userId;

  // 任何人都不能改自己的角色/状态：否则助教可自我提权成教师，教师也能自降
  if (isSelf && (next.role !== undefined || next.status !== undefined)) {
    return NextResponse.json(
      { error: '不能修改自己的角色或状态' },
      { status: 403 }
    );
  }

  // 助教只能管学生（队长/成员）：不能授予教师/助教，也不能碰教师/助教的记录
  if (callerRole === 'assistant') {
    if (next.role === 'teacher' || next.role === 'assistant') {
      return NextResponse.json(
        { error: '助教不能授予教师或助教角色' },
        { status: 403 }
      );
    }
    if (existing.role === 'teacher' || existing.role === 'assistant') {
      return NextResponse.json(
        { error: '助教不能修改教师或助教的成员记录' },
        { status: 403 }
      );
    }
  }

  // 班级必须属于本课程：否则能把学生挂到别的课程的班级上
  if (next.classId !== undefined && next.classId !== null) {
    const [klass] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(
        and(eq(classes.id, next.classId), eq(classes.courseId, existing.courseId))
      )
      .limit(1);
    if (!klass) {
      return NextResponse.json({ error: '班级不属于该课程' }, { status: 400 });
    }
  }

  const roleChanged = next.role !== undefined && next.role !== existing.role;

  if (roleChanged) {
    if (next.role === 'captain') {
      await promoteToCaptain(existing);
    } else if (existing.role === 'captain') {
      await demoteCaptain(existing);
    }
  }

  const [updated] = await db
    .update(courseMemberships)
    .set(next)
    .where(eq(courseMemberships.id, membershipId))
    .returning();

  return NextResponse.json({ membership: updated });
}

/** 该成员在本课程的活跃小组成员记录。 */
async function activeGroupRows(userId: number, courseId: number) {
  return db
    .select({ groupId: groupMembers.groupId, captainId: groups.captainId })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groups.courseId, courseId),
        eq(groupMembers.userId, userId),
        isNull(groupMembers.leftAt)
      )
    );
}

/** 设为队长：接管其所在组的 captainId 与 duty=lead；原组长降回队员。 */
async function promoteToCaptain(m: typeof courseMemberships.$inferSelect) {
  const rows = await activeGroupRows(m.userId, m.courseId);
  for (const row of rows) {
    if (row.captainId && row.captainId !== m.userId) {
      await db
        .update(courseMemberships)
        .set({ role: 'member' })
        .where(
          and(
            eq(courseMemberships.courseId, m.courseId),
            eq(courseMemberships.userId, row.captainId),
            eq(courseMemberships.role, 'captain')
          )
        );
      await db
        .update(groupMembers)
        .set({ duty: 'contributor' })
        .where(
          and(
            eq(groupMembers.groupId, row.groupId),
            eq(groupMembers.userId, row.captainId)
          )
        );
    }
    await db.update(groups).set({ captainId: m.userId }).where(eq(groups.id, row.groupId));
    await db
      .update(groupMembers)
      .set({ duty: 'lead' })
      .where(and(eq(groupMembers.groupId, row.groupId), eq(groupMembers.userId, m.userId)));
  }
}

/** 取消队长：释放组内 duty 与 groups.captain_id。 */
async function demoteCaptain(m: typeof courseMemberships.$inferSelect) {
  const rows = await activeGroupRows(m.userId, m.courseId);
  for (const row of rows) {
    await db
      .update(groupMembers)
      .set({ duty: 'contributor' })
      .where(and(eq(groupMembers.groupId, row.groupId), eq(groupMembers.userId, m.userId)));
  }
  await db
    .update(groups)
    .set({ captainId: null })
    .where(and(eq(groups.courseId, m.courseId), eq(groups.captainId, m.userId)));
}

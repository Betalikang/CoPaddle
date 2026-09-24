import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { groupMembers, groups, taskAssignments, tasks } from '../db/schema';
import type { CourseRole } from '../db/schema';

/**
 * 任务/契约路由的鉴权 helper：任务 → 小组 → 课程 三级定位课程 id，
 * 再由 assertCourseRole 按课程角色校验。队员仅能改自己主责的任务状态（规格书 S5）。
 */

export async function getTaskCourseId(taskId: number): Promise<number | null> {
  const [row] = await db
    .select({ courseId: groups.courseId, groupId: tasks.groupId })
    .from(tasks)
    .innerJoin(groups, eq(groups.id, tasks.groupId))
    .where(eq(tasks.id, taskId))
    .limit(1);
  return row?.courseId ?? null;
}

/** 是否是该任务的 lead 主责人。 */
export async function isTaskLead(taskId: number, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: taskAssignments.id })
    .from(taskAssignments)
    .where(
      and(
        eq(taskAssignments.taskId, taskId),
        eq(taskAssignments.userId, userId),
        eq(taskAssignments.raci, 'lead')
      )
    )
    .limit(1);
  return Boolean(row);
}

/** 是否是该小组在册成员。 */
export async function isGroupMember(groupId: number, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: groupMembers.id })
    .from(groupMembers)
    .where(
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.userId, userId),
        isNull(groupMembers.leftAt)
      )
    )
    .limit(1);
  return Boolean(row);
}

/**
 * 组级资源鉴权（规格书 S5）：课程角色 ∩ 小组归属。
 * 教师/助教可跨组查看；队长/队员必须是在册组员，否则 403（防组间 IDOR）。
 */
export async function assertGroupAccess(
  groupId: number,
  user: { id: number },
  courseRole: string
): Promise<boolean> {
  if (courseRole === 'teacher' || courseRole === 'assistant') return true;
  return isGroupMember(groupId, user.id);
}

export type { CourseRole };

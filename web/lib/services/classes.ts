/**
 * 班级服务：班级是名单的组织维度，小组挂在班级下。
 * 与名单管理同一套 classId 语义（course_memberships.class_id）。
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/drizzle';
import { classes, courseMemberships, groups } from '../db/schema';

export type ClassRow = {
  id: number;
  name: string;
  major: string | null;
  grade: string | null;
  advisor: string | null;
  memberCount: number;
  groupCount: number;
};

/** 班级列表（人数与组数实时统计，与名单管理口径一致）。 */
export async function listClasses(courseId: number): Promise<ClassRow[]> {
  const classRows = await db
    .select()
    .from(classes)
    .where(eq(classes.courseId, courseId))
    .orderBy(classes.name);

  if (classRows.length === 0) return [];

  const ids = classRows.map((c) => c.id);
  const memberCounts = await db
    .select({
      classId: courseMemberships.classId,
      n: sql<number>`count(*)::int`
    })
    .from(courseMemberships)
    .where(
      and(
        eq(courseMemberships.courseId, courseId),
        eq(courseMemberships.status, 'active'),
        inArray(courseMemberships.classId, ids)
      )
    )
    .groupBy(courseMemberships.classId);

  const groupCounts = await db
    .select({
      classId: groups.classId,
      n: sql<number>`count(*)::int`
    })
    .from(groups)
    .where(and(eq(groups.courseId, courseId), eq(groups.status, 'active'), inArray(groups.classId, ids)))
    .groupBy(groups.classId);

  const mc = new Map(memberCounts.map((r) => [r.classId, r.n]));
  const gc = new Map(groupCounts.map((r) => [r.classId, r.n]));

  return classRows.map((c) => ({
    id: c.id,
    name: c.name,
    major: c.major,
    grade: c.grade,
    advisor: c.advisor,
    memberCount: mc.get(c.id) ?? 0,
    groupCount: gc.get(c.id) ?? 0
  }));
}

export async function createClass(
  courseId: number,
  input: { name: string; major?: string; grade?: string; advisor?: string }
) {
  const [row] = await db
    .insert(classes)
    .values({
      courseId,
      name: input.name.trim(),
      major: input.major?.trim() || null,
      grade: input.grade?.trim() || null,
      advisor: input.advisor?.trim() || null,
      memberCount: 0
    })
    .returning();
  return row;
}

export async function updateClass(
  classId: number,
  input: { name?: string; major?: string | null; grade?: string | null; advisor?: string | null }
) {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.major !== undefined) patch.major = input.major?.trim() || null;
  if (input.grade !== undefined) patch.grade = input.grade?.trim() || null;
  if (input.advisor !== undefined) patch.advisor = input.advisor?.trim() || null;
  if (Object.keys(patch).length === 0) {
    const [row] = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
    return row ?? null;
  }
  const [row] = await db.update(classes).set(patch).where(eq(classes.id, classId)).returning();
  return row ?? null;
}

/**
 * 删除班级：成员的 classId 置空（人留在名单里），该班小组解除班级归属。
 * 若班内仍有 active 小组，调用方应提示先解散。
 */
export async function deleteClass(classId: number): Promise<{ ok: true } | { error: string }> {
  const [activeGroup] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.classId, classId), eq(groups.status, 'active')))
    .limit(1);
  if (activeGroup) {
    return { error: '该班仍有进行中的小组，请先解散小组再删除班级' };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(courseMemberships)
      .set({ classId: null })
      .where(eq(courseMemberships.classId, classId));
    await tx.update(groups).set({ classId: null }).where(eq(groups.classId, classId));
    await tx.delete(classes).where(eq(classes.id, classId));
  });
  return { ok: true };
}

export async function getClassCourseId(classId: number): Promise<number | null> {
  const [row] = await db
    .select({ courseId: classes.courseId })
    .from(classes)
    .where(eq(classes.id, classId))
    .limit(1);
  return row?.courseId ?? null;
}

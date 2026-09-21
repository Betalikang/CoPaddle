import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/drizzle';
import {
  Course,
  CourseMembership,
  CourseRole,
  NewCourse,
  courseMemberships,
  courseSettings,
  courses,
  users
} from '../db/schema';
import type { CreateCourseInput, UpdateCourseInput, UpdateSettingsInput } from '@/lib/validation/courses';

export type CourseWithRole = Course & { myRole: CourseRole };

/**
 * 建课：一条事务里落 courses + course_settings 默认值 + 教师本人 membership。
 * 默认权重取规格书 S4.2：技能覆盖 1.2 / 弱连接 0.8 / 均衡 1.0 / 历史规避 1.0。
 */
export async function createCourse(
  input: CreateCourseInput,
  teacherId: number
): Promise<Course> {
  const newCourse: NewCourse = {
    name: input.name,
    code: input.code ?? null,
    term: input.term ?? '2026-2027-1',
    description: input.description ?? null,
    teacherId,
    createdBy: teacherId,
    status: 'draft'
  };

  return db.transaction(async (tx) => {
    const [course] = await tx.insert(courses).values(newCourse).returning();

    await tx.insert(courseSettings).values({ courseId: course.id });

    await tx.insert(courseMemberships).values({
      courseId: course.id,
      userId: teacherId,
      role: 'teacher',
      status: 'active'
    });

    return course;
  });
}

/** 我参与的课程：教的 + 被加入的，附我在每门课的角色。 */
export async function listMyCourses(userId: number): Promise<CourseWithRole[]> {
  const rows = await db
    .select({
      course: courses,
      myRole: courseMemberships.role
    })
    .from(courseMemberships)
    .innerJoin(courses, eq(courseMemberships.courseId, courses.id))
    .where(
      and(
        eq(courseMemberships.userId, userId),
        eq(courseMemberships.status, 'active'),
        sql`${courses.deletedAt} IS NULL`
      )
    )
    .orderBy(sql`${courses.createdAt} DESC`);

  return rows.map((r) => ({ ...r.course, myRole: r.myRole as CourseRole }));
}

/** 课程详情（含设置），仅参与人可读；返回 null 表示无权限或不存在。 */
export async function getCourseForUser(
  courseId: number,
  userId: number
): Promise<{ course: Course; settings: typeof courseSettings.$inferSelect; myRole: CourseRole } | null> {
  const rows = await db
    .select({
      course: courses,
      settings: courseSettings,
      myRole: courseMemberships.role
    })
    .from(courseMemberships)
    .innerJoin(courses, eq(courseMemberships.courseId, courses.id))
    .innerJoin(courseSettings, eq(courseSettings.courseId, courses.id))
    .where(
      and(
        eq(courses.id, courseId),
        eq(courseMemberships.userId, userId),
        eq(courseMemberships.status, 'active'),
        sql`${courses.deletedAt} IS NULL`
      )
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return { course: row.course, settings: row.settings, myRole: row.myRole as CourseRole };
}

export async function updateCourse(
  courseId: number,
  patch: UpdateCourseInput
): Promise<Course> {
  const [course] = await db
    .update(courses)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(courses.id, courseId))
    .returning();
  return course;
}

/**
 * 改课程设置。三类证据权重合计必须为 1.0（允许 0.01 浮点误差）——
 * 规格书 S4.7：w_artifact + w_process + w_peer = 1.0。
 */
export async function updateCourseSettings(
  courseId: number,
  patch: UpdateSettingsInput
): Promise<typeof courseSettings.$inferSelect> {
  const { wArtifact, wProcess, wPeer, ...rest } = patch;

  if (wArtifact !== undefined || wProcess !== undefined || wPeer !== undefined) {
    const [current] = await db
      .select()
      .from(courseSettings)
      .where(eq(courseSettings.courseId, courseId))
      .limit(1);
    if (!current) throw new Error('course_settings 不存在');

    const artifact = wArtifact ?? Number(current.wArtifact);
    const process = wProcess ?? Number(current.wProcess);
    const peer = wPeer ?? Number(current.wPeer);
    const total = artifact + process + peer;
    if (Math.abs(total - 1) > 0.011) {
      throw new EvidenceWeightError(
        `三类证据权重合计必须为 1.0，当前为 ${total.toFixed(2)}`
      );
    }
  }

  // 组规模上下限一致性
  if (rest.minGroupSize !== undefined && rest.maxGroupSize !== undefined) {
    if (rest.minGroupSize > rest.maxGroupSize) {
      throw new EvidenceWeightError('min_group_size 不能大于 max_group_size');
    }
  }

  // numeric 列统一按字符串写入（drizzle numeric 不接受 JS number）
  const numericFields = [
    'wSkillCover',
    'wWeakTie',
    'wBalance',
    'wHistoryAvoid',
    'wArtifact',
    'wProcess',
    'wPeer',
    'fairShareThreshold'
  ] as const;
  const setObj: Record<string, unknown> = { ...patch, updatedAt: new Date() };
  for (const f of numericFields) {
    const v = (patch as Record<string, unknown>)[f];
    if (v !== undefined) setObj[f] = String(v);
  }

  const [settings] = await db
    .update(courseSettings)
    .set(setObj)
    .where(eq(courseSettings.courseId, courseId))
    .returning();
  return settings;
}

export class EvidenceWeightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvidenceWeightError';
  }
}

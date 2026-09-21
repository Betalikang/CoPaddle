import { eq, like, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '@/lib/db/drizzle';
import { courseMemberships, courses, users } from '@/lib/db/schema';
import {
  EvidenceWeightError,
  createCourse,
  getCourseForUser,
  listMyCourses,
  updateCourseSettings
} from '@/lib/services/courses';
import {
  addEnrollment,
  importEnrollmentsCsv,
  listEnrollments
} from '@/lib/services/enrollments';
import { getMySkillCard, upsertSkillCard } from '@/lib/services/skill-cards';

// 测试数据：随机后缀避免与种子数据/重复运行冲突
const RUN = crypto.randomUUID().slice(0, 8);
const teacherEmail = `s1-teacher-${RUN}@test.local`;
const studentEmail = `s1-student-${RUN}@test.local`;

let teacherId: number;
let courseId: number;

beforeAll(async () => {
  const [teacher] = await db
    .insert(users)
    .values({ email: teacherEmail, passwordHash: 'x', name: 'S1 教师', role: 'member' })
    .returning();
  teacherId = teacher.id;
  const course = await createCourse({ name: `S1 测试课程-${RUN}` }, teacherId);
  courseId = course.id;
});

afterAll(async () => {
  // 级联删除课程带走 memberships / skill_cards / settings / classes
  await db.delete(courses).where(eq(courses.id, courseId));
  // 清理本轮创建的全部测试 user（email 统一带 RUN 后缀）；
  // 用 drizzle like 而非 sql 模板（postgres-js 对 LIKE 模式参数推断类型会失败）
  await db.delete(users).where(like(users.email, `%-${RUN}@test.local`));
});

describe('建课与课程设置', () => {
  it('建课后自动落 course_settings 默认值与教师 membership', async () => {
    const data = await getCourseForUser(courseId, teacherId);
    expect(data).not.toBeNull();
    expect(data!.myRole).toBe('teacher');
    // 规格书 S4.2 默认权重
    expect(Number(data!.settings.wSkillCover)).toBe(1.2);
    expect(Number(data!.settings.wWeakTie)).toBe(0.8);
    expect(Number(data!.settings.wBalance)).toBe(1.0);
    expect(Number(data!.settings.wHistoryAvoid)).toBe(1.0);
    // 三类证据权重合计 1.0（规格书 S4.7）
    const sum =
      Number(data!.settings.wArtifact) +
      Number(data!.settings.wProcess) +
      Number(data!.settings.wPeer);
    expect(Math.abs(sum - 1)).toBeLessThan(0.011);
    // 搭便车阈值来自实证研究（14%）
    expect(Number(data!.settings.fairShareThreshold)).toBe(0.14);
  });

  it('非参与人看不到课程', async () => {
    const [outsider] = await db
      .insert(users)
      .values({ email: `s1-outsider-${RUN}@test.local`, passwordHash: 'x' })
      .returning();
    const data = await getCourseForUser(courseId, outsider.id);
    expect(data).toBeNull();
    await db.delete(users).where(eq(users.id, outsider.id));
  });

  it('listMyCourses 返回角色', async () => {
    const list = await listMyCourses(teacherId);
    expect(list.some((c) => c.id === courseId && c.myRole === 'teacher')).toBe(true);
  });

  it('证据权重合计不为 1.0 时拒绝', async () => {
    await expect(
      updateCourseSettings(courseId, { wArtifact: 0.7 })
    ).rejects.toBeInstanceOf(EvidenceWeightError);
  });

  it('合法权重与规模修改生效', async () => {
    const settings = await updateCourseSettings(courseId, {
      wArtifact: 0.6,
      wPeer: 0.1,
      groupCount: 6,
      minGroupSize: 3,
      maxGroupSize: 6
    });
    expect(Number(settings.wArtifact)).toBe(0.6);
    expect(Number(settings.wPeer)).toBe(0.1);
    expect(settings.groupCount).toBe(6);
  });

  it('min > max 拒绝', async () => {
    await expect(
      updateCourseSettings(courseId, { minGroupSize: 7, maxGroupSize: 5 })
    ).rejects.toBeInstanceOf(EvidenceWeightError);
  });
});

describe('名单导入', () => {
  it('单个加入：创建 invited 账号与 membership', async () => {
    const result = await addEnrollment(courseId, {
      email: studentEmail,
      name: 'S1 学生',
      studentNo: `2026${RUN}01`
    });
    expect(result.created).toBe(true);
    expect(result.membership.role).toBe('member');

    // 重复加入不报错、created=false（规格书 B-03 不覆盖）
    const again = await addEnrollment(courseId, { email: studentEmail });
    expect(again.created).toBe(false);
  });

  it('CSV 批量导入返回逐行校验报告', async () => {
    const csv = [
      'name,email,student_no,class_name',
      `张三,zhang-${RUN}@test.local,2026${RUN}02,数媒本24-1`,
      `李四,li-${RUN}@test.local,2026${RUN}03,数媒本24-1`,
      '王五,not-an-email,20260004,数媒本24-1'
    ].join('\n');

    const report = await importEnrollmentsCsv(courseId, csv);
    expect(report.total).toBe(3);
    expect(report.added).toBe(2);
    expect(report.skipped).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].row).toBe(4);

    const list = await listEnrollments(courseId);
    // 教师 + 单人 studentEmail + CSV 成功 2 行 = 4（outsider 已删，不占名额）
    expect(list).toHaveLength(4);
    expect(list.some((r) => r.className === '数媒本24-1')).toBe(true);
  });
});

describe('技能卡', () => {
  it('提交后读回一致（upsert）', async () => {
    const skills = { 编程: 4, 写作: 3, 数据分析: 2 };
    await upsertSkillCard(courseId, teacherId, {
      skills,
      availability: { mon: ['08:00-12:00'] },
      preferRoles: ['建模']
    });
    const card = await getMySkillCard(courseId, teacherId);
    expect(card).not.toBeNull();
    expect(card!.skills).toEqual(skills);

    // 再提交一次是更新不是新增
    await upsertSkillCard(courseId, teacherId, { skills: { 编程: 5 } });
    const updated = await getMySkillCard(courseId, teacherId);
    expect(updated!.id).toBe(card!.id);
    expect(updated!.skills).toEqual({ 编程: 5 });
  });
});

describe('建模红线：角色是课程级的', () => {
  it('同一学生在两门课可以有不同角色，users 表不存课程角色', async () => {
    const [other] = await db
      .insert(users)
      .values({ email: `s1-dual-${RUN}@test.local`, passwordHash: 'x' })
      .returning();
    const courseB = await createCourse({ name: `S1 课程B-${RUN}` }, teacherId);

    // 在 courseId 是 member，在 courseB 是 captain
    await db
      .insert(courseMemberships)
      .values({ courseId, userId: other.id, role: 'member', status: 'active' });
    await db
      .insert(courseMemberships)
      .values({ courseId: courseB.id, userId: other.id, role: 'captain', status: 'active' });

    const inA = await getCourseForUser(courseId, other.id);
    const inB = await getCourseForUser(courseB.id, other.id);
    expect(inA!.myRole).toBe('member');
    expect(inB!.myRole).toBe('captain');

    // users 表里没有课程角色列可写（编译期即保证，这里验证行数据无角色泄漏）
    const [raw] = await db.select().from(users).where(eq(users.id, other.id));
    expect(Object.keys(raw)).not.toContain('courseRole');

    await db.delete(courses).where(eq(courses.id, courseB.id));
    // 先摘掉主课程里的 membership 再删 user（FK 约束）
    await db.delete(courseMemberships).where(eq(courseMemberships.userId, other.id));
    await db.delete(users).where(eq(users.id, other.id));
  });
});

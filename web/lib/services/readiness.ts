import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/drizzle';
import {
  courseMemberships,
  courseSettings,
  courses,
  groupingPlans,
  groupingRuns,
  groups,
  skillCards,
  users
} from '../db/schema';
import { diagnoseFeasibility, deriveGroupingStage } from '@/lib/grouping-readiness';

/**
 * 教师端「课程就绪度」：把「这课走到哪一步了、下一步点哪里」一次算清。
 *
 * 为什么放在服务端而不是让页面自己拼：判断依据是多张表（名单、技能卡、求解记录、
 * 落库小组、课程设置），页面上分散拼容易各页算得不一样——比如名单页说 40 人、
 * 分组页却说 38 人。这里只查一次，所有入口读同一份数字。
 */
export type CourseReadiness = {
  course: { id: number; name: string; status: string };
  students: {
    /** 在册学生数（role 为 member/captain 且 status=active；教师/助教不计入） */
    total: number;
    /** 至少填过一次技能卡的人数 */
    skillCardFilled: number;
    /** 技能卡缺失人数 */
    skillCardMissing: number;
  };
  settings: {
    groupCount: number;
    minGroupSize: number;
    maxGroupSize: number;
    allowCrossClass: boolean;
  };
  grouping: {
    /** 最近一次求解记录（成功/失败/无解都在内），从未求解为 null */
    latestRun: {
      id: number;
      status: string;
      degraded: boolean;
      createdAt: string;
      errorDetail: string | null;
    } | null;
    /** 最近一次成功求解的方案数（0 = 没有可用方案） */
    planCount: number;
    /** 已落库的进行中小组数 */
    activeGroupCount: number;
    /** 是否有被选定过的方案 */
    hasSelectedPlan: boolean;
  };
  /** 可行性诊断（纯函数，见 lib/grouping-readiness.ts） */
  feasibility: ReturnType<typeof diagnoseFeasibility>;
  /** 当前所处阶段与下一步 */
  stage: ReturnType<typeof deriveGroupingStage>;
};

/**
 * 汇总一门课的就绪度。
 *
 * 返回 null 表示课程不存在——调用方按 404 处理，不要用空对象假装存在。
 */
export async function getCourseReadiness(courseId: number): Promise<CourseReadiness | null> {
  const [courseRow] = await db
    .select({ id: courses.id, name: courses.name, status: courses.status })
    .from(courses)
    .where(and(eq(courses.id, courseId), isNull(courses.deletedAt)))
    .limit(1);
  if (!courseRow) return null;

  const [settingsRow] = await db
    .select()
    .from(courseSettings)
    .where(eq(courseSettings.courseId, courseId))
    .limit(1);

  // 在册学生（不含教师/助教——他们不进小组，计进来会让「40 人分 8 组」算错）
  const studentRows = await db
    .select({ userId: courseMemberships.userId })
    .from(courseMemberships)
    .where(
      and(
        eq(courseMemberships.courseId, courseId),
        eq(courseMemberships.status, 'active'),
        inArray(courseMemberships.role, ['member', 'captain'])
      )
    );

  const studentIds = studentRows.map((r) => r.userId);
  const cardRows = studentIds.length
    ? await db
        .select({ userId: skillCards.userId })
        .from(skillCards)
        .innerJoin(users, eq(skillCards.userId, users.id))
        .where(
          and(
            eq(skillCards.courseId, courseId),
            inArray(skillCards.userId, studentIds),
            isNull(users.deletedAt)
          )
        )
        .groupBy(skillCards.userId)
    : [];

  const studentCount = studentIds.length;
  const skillCardFilled = cardRows.length;

  // 最近一次求解记录：不看状态，失败与无解也要让教师看见原因
  const [latestRunRow] = await db
    .select({
      id: groupingRuns.id,
      status: groupingRuns.status,
      solverStatus: groupingRuns.solverStatus,
      createdAt: groupingRuns.createdAt,
      errorDetail: groupingRuns.errorDetail
    })
    .from(groupingRuns)
    .where(eq(groupingRuns.courseId, courseId))
    .orderBy(desc(groupingRuns.createdAt))
    .limit(1);

  // 最近一次成功 run 的方案数：只有它有方案可选
  const [okRun] = await db
    .select({ id: groupingRuns.id })
    .from(groupingRuns)
    .where(and(eq(groupingRuns.courseId, courseId), eq(groupingRuns.status, 'ok')))
    .orderBy(desc(groupingRuns.createdAt))
    .limit(1);

  const planRows = okRun
    ? await db
        .select({ id: groupingPlans.id, isSelected: groupingPlans.isSelected })
        .from(groupingPlans)
        .where(eq(groupingPlans.runId, okRun.id))
    : [];

  const activeGroupRows = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.courseId, courseId), eq(groups.status, 'active')));

  const settings = {
    groupCount: settingsRow?.groupCount ?? 8,
    minGroupSize: settingsRow?.minGroupSize ?? 3,
    maxGroupSize: settingsRow?.maxGroupSize ?? 6,
    allowCrossClass: settingsRow?.allowCrossClass ?? false
  };

  const latestRun = latestRunRow
    ? {
        id: latestRunRow.id,
        status: latestRunRow.status,
        // degraded 只在成功求解时有意义：solverStatus='greedy' 才是贪心兜底
        degraded: latestRunRow.status === 'ok' && latestRunRow.solverStatus === 'greedy',
        createdAt: latestRunRow.createdAt.toISOString(),
        errorDetail: latestRunRow.errorDetail
      }
    : null;

  const activeGroupCount = activeGroupRows.length;
  const feasibility = diagnoseFeasibility({ studentCount, ...settings });
  const stage = deriveGroupingStage({
    studentCount,
    latestRun,
    hasPlans: planRows.length > 0,
    activeGroupCount
  });

  return {
    course: { id: courseRow.id, name: courseRow.name, status: courseRow.status },
    students: {
      total: studentCount,
      skillCardFilled,
      skillCardMissing: Math.max(0, studentCount - skillCardFilled)
    },
    settings,
    grouping: {
      latestRun,
      planCount: planRows.length,
      activeGroupCount,
      hasSelectedPlan: planRows.some((p) => p.isSelected)
    },
    feasibility,
    stage
  };
}
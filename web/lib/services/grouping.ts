import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/drizzle';
import {
  CourseSettings,
  constraints,
  courseMemberships,
  courseSettings,
  groupingPlans,
  groupingRuns,
  groups,
  groupMembers,
  skillCards,
  socialEdges,
  users
} from '../db/schema';
import type { GroupingMoveInput, GroupingSwapInput } from '@/lib/validation/grouping';
import { AlgoServiceError, callAlgo } from '@/lib/algo/client';

/** algo 侧 /internal/grouping/* 的响应类型（与 algo/app/schemas.py 对齐） */
type AlgoPlan = {
  label: string;
  strategy: string;
  groups: string[][];
  scores: {
    skill_cover: number;
    weak_tie: number;
    balance: number;
    history_avoid: number;
    total: number;
  };
  explanation: string;
};

type AlgoSolveResponse = {
  status: string;
  plans: AlgoPlan[];
  detail: string;
  degraded: boolean;
};

type AlgoScoreResponse = {
  ok: boolean;
  total_before: number;
  total_after: number;
  scores?: {
    skill_cover: number;
    weak_tie: number;
    balance: number;
    history_avoid: number;
    total: number;
  };
};

type AlgoValidateResponse = {
  ok: boolean;
  violations: { code: string; message: string }[];
};

const STRATEGY_LABEL: Record<string, string> = {
  skill_first: '方案A · 能力互补优先（推荐）',
  weaktie_first: '方案B · 弱连接优先',
  fairness_first: '方案C · 公平优先'
};

const STRATEGY_WEIGHTS: Record<string, Record<string, number>> = {
  skill_first: { skill_cover: 1.5, weak_tie: 0.6, balance: 1.2, history_avoid: 1.0 },
  weaktie_first: { skill_cover: 1.0, weak_tie: 1.6, balance: 1.0, history_avoid: 0.8 },
  fairness_first: { skill_cover: 1.0, weak_tie: 0.6, balance: 1.8, history_avoid: 1.2 }
};

type MemberRow = {
  userId: number;
  studentNo: string | null;
  name: string | null;
  classId: number | null;
  skills: Record<string, number>;
};

/** 汇总求解输入：在册成员 + 技能卡 + active 约束 + 社交边。 */
async function prepareInput(courseId: number) {
  const rows = await db
    .select({
      userId: users.id,
      studentNo: users.studentNo,
      name: users.name,
      classId: courseMemberships.classId,
      skills: skillCards.skills
    })
    .from(courseMemberships)
    .innerJoin(users, eq(courseMemberships.userId, users.id))
    .leftJoin(
      skillCards,
      and(eq(skillCards.courseId, courseMemberships.courseId), eq(skillCards.userId, users.id))
    )
    .where(
      and(
        eq(courseMemberships.courseId, courseId),
        eq(courseMemberships.status, 'active'),
        // 只分学生：教师/助教是教学团队，不进小组（规格书 S5 角色语义）
        inArray(courseMemberships.role, ['member', 'captain'])
      )
    );

  const members: MemberRow[] = rows.map((r) => ({
    userId: r.userId,
    studentNo: r.studentNo,
    name: r.name,
    classId: r.classId,
    skills: r.skills ?? {}
  }));

  // active 约束才参与求解（规格书 S1：pending 不参与）
  const activeConstraints = await db
    .select()
    .from(constraints)
    .where(and(eq(constraints.courseId, courseId), eq(constraints.status, 'active')));

  const edges = await db
    .select()
    .from(socialEdges)
    .where(eq(socialEdges.courseId, courseId));

  return {
    members,
    students: members.map((m) => ({
      id: String(m.userId),
      skills: m.skills,
      class_id: m.classId === null ? null : String(m.classId)
    })),
    forbiddenPairs: activeConstraints
      .filter((c) => c.type === 'no_same_group')
      .map((c) => [String(c.memberA), String(c.memberB)]),
    requiredPairs: activeConstraints
      .filter((c) => c.type === 'must_same_group')
      .map((c) => [String(c.memberA), String(c.memberB)]),
    edges: edges.map((e) => [String(e.userA), String(e.userB), Number(e.weight)]),
    historyPairs: [] as [string, string][]
  };
}

async function getSettings(courseId: number): Promise<CourseSettings> {
  const [row] = await db
    .select()
    .from(courseSettings)
    .where(eq(courseSettings.courseId, courseId))
    .limit(1);
  if (!row) throw new Error('course_settings 不存在');
  return row;
}

/**
 * 触发生成分组方案（规格书 B-06）：
 * 建 run → 调 algo solve → 落三套方案。同步等待（≤10s，前端 loading）。
 */
export async function runGrouping(courseId: number, teacherId: number) {
  const settings = await getSettings(courseId);
  const input = await prepareInput(courseId);

  if (input.students.length === 0) {
    return { error: '名单为空，请先导入学生' as const };
  }

  const [run] = await db
    .insert(groupingRuns)
    .values({
      courseId,
      triggeredBy: teacherId,
      mode: 'cpsat',
      params: {
        studentCount: input.students.length,
        groupCount: settings.groupCount,
        minGroupSize: settings.minGroupSize,
        maxGroupSize: settings.maxGroupSize,
        forbiddenCount: input.forbiddenPairs.length,
        requiredCount: input.requiredPairs.length,
        edgeCount: input.edges.length
      },
      status: 'running'
    })
    .returning();

  const startedAt = Date.now();
  try {
    const result = await callAlgo<AlgoSolveResponse>(
      '/internal/grouping/solve',
      {
        course_id: String(courseId),
        students: input.students,
        num_groups: settings.groupCount,
        min_group_size: settings.minGroupSize,
        max_group_size: settings.maxGroupSize,
        forbidden_pairs: input.forbiddenPairs,
        required_pairs: input.requiredPairs,
        edges: input.edges,
        history_pairs: input.historyPairs,
        weights: {
          skill_cover: Number(settings.wSkillCover),
          weak_tie: Number(settings.wWeakTie),
          balance: Number(settings.wBalance),
          history_avoid: Number(settings.wHistoryAvoid)
        },
        time_limit_seconds: 10
      },
      60000
    );

    await db
      .update(groupingRuns)
      .set({
        status: result.status === 'ok' ? 'ok' : result.status,
        solverStatus: result.degraded ? 'greedy' : 'optimal',
        durationMs: Date.now() - startedAt,
        solutionsFound: result.plans.length,
        errorDetail: result.detail || null
      })
      .where(eq(groupingRuns.id, run.id));

    if (result.status !== 'ok' || result.plans.length === 0) {
      return { error: result.detail || '求解失败，请调整约束后重试' };
    }

    const planRows = result.plans.map((p) => ({
      runId: run.id,
      label: STRATEGY_LABEL[p.strategy] ?? p.label,
      strategy: p.strategy,
      totalScore: String(p.scores.total),
      scoreSkillCover: String(p.scores.skill_cover),
      scoreWeakTie: String(p.scores.weak_tie),
      scoreBalance: String(p.scores.balance),
      scoreHistoryAvoid: String(p.scores.history_avoid),
      explanation: p.explanation,
      groups: p.groups.map((g) => g.map(Number)),
      originalGroups: p.groups.map((g) => g.map(Number)),
      weights: STRATEGY_WEIGHTS[p.strategy] ?? {}
    }));

    await db.insert(groupingPlans).values(planRows);
    return { runId: run.id };
  } catch (err) {
    await db
      .update(groupingRuns)
      .set({
        status: 'error',
        durationMs: Date.now() - startedAt,
        errorDetail: err instanceof Error ? err.message : String(err)
      })
      .where(eq(groupingRuns.id, run.id));
    if (err instanceof AlgoServiceError) throw err;
    throw new AlgoServiceError(err instanceof Error ? err.message : '求解失败');
  }
}

export async function listRuns(courseId: number) {
  return db
    .select()
    .from(groupingRuns)
    .where(eq(groupingRuns.courseId, courseId))
    .orderBy(groupingRuns.createdAt);
}

export async function getRunWithPlans(runId: number) {
  const [run] = await db
    .select()
    .from(groupingRuns)
    .where(eq(groupingRuns.id, runId))
    .limit(1);
  if (!run) return null;
  const plans = await db
    .select()
    .from(groupingPlans)
    .where(eq(groupingPlans.runId, runId))
    .orderBy(groupingPlans.id);
  return { run, plans };
}

/** 最近一次成功的 run（工作台默认打开）。 */
export async function getLatestRun(courseId: number) {
  const runs = await db
    .select()
    .from(groupingRuns)
    .where(and(eq(groupingRuns.courseId, courseId), eq(groupingRuns.status, 'ok')))
    .orderBy(groupingRuns.createdAt);
  const latest = runs[runs.length - 1];
  if (!latest) return null;
  return getRunWithPlans(latest.id);
}

// ---- 预览与应用（规格书 S4.3：绝不重新求解，内存重算，<= 50ms）----

function applyMoveToGroups(
  planGroups: number[][],
  move: { userId: number; fromGroup: number; toGroup: number } | { userA: number; userB: number }
): number[][] {
  const next = planGroups.map((g) => [...g]);
  if ('userId' in move) {
    const { userId, fromGroup, toGroup } = move;
    if (fromGroup < 0 || fromGroup >= next.length || toGroup < 0 || toGroup >= next.length) {
      throw new Error('组索引越界');
    }
    const idx = next[fromGroup].indexOf(userId);
    if (idx === -1) throw new Error('该成员不在来源组');
    next[fromGroup].splice(idx, 1);
    next[toGroup].push(userId);
  } else {
    const { userA, userB } = move;
    const ga = next.findIndex((g) => g.includes(userA));
    const gb = next.findIndex((g) => g.includes(userB));
    if (ga === -1 || gb === -1) throw new Error('成员不在方案中');
    next[ga] = next[ga].map((m) => (m === userA ? userB : m));
    next[gb] = next[gb].map((m) => (m === userB ? userA : m));
  }
  return next;
}

async function scoreGroups(
  courseId: number,
  planGroups: number[][],
  weights: Record<string, number>
): Promise<{ scores: AlgoPlan['scores']; violations: AlgoValidateResponse['violations'] }> {
  const input = await prepareInput(courseId);
  const settings = await getSettings(courseId);
  const body = {
    plan_groups: planGroups.map((g) => g.map(String)),
    user_id: String(planGroups.flat()[0] ?? '0'),
    from_group: 0,
    to_group: 0,
    num_groups: planGroups.length,
    min_group_size: settings.minGroupSize,
    max_group_size: settings.maxGroupSize,
    allow_cross_class: settings.allowCrossClass,
    students: input.students,
    forbidden_pairs: input.forbiddenPairs,
    required_pairs: input.requiredPairs,
    edges: input.edges,
    history_pairs: input.historyPairs,
    weights: {
      skill_cover: weights.skill_cover ?? 1.2,
      weak_tie: weights.weak_tie ?? 0.8,
      balance: weights.balance ?? 1.0,
      history_avoid: weights.history_avoid ?? 1.0
    }
  };
  const [validate, score] = await Promise.all([
    callAlgo<AlgoValidateResponse>('/internal/grouping/validate', body, 10000),
    callAlgo<AlgoScoreResponse>('/internal/grouping/score', body, 10000)
  ]);
  return {
    scores: {
      skill_cover: score.scores?.skill_cover ?? 0,
      weak_tie: score.scores?.weak_tie ?? 0,
      balance: score.scores?.balance ?? 0,
      history_avoid: score.scores?.history_avoid ?? 0,
      total: score.total_after
    },
    violations: validate.violations
  };
}

/** 拖动预演：不落库，返回四维增减与硬约束校验。 */
export async function previewMove(planId: number, move: GroupingMoveInput | GroupingSwapInput) {
  const plan = await getPlan(planId);
  const after = applyMoveToGroups(plan.groups, move);
  const [before, afterScore] = await Promise.all([
    scoreGroups(plan.courseId, plan.groups, plan.weights ?? {}),
    scoreGroups(plan.courseId, after, plan.weights ?? {})
  ]);
  const dims = ['skill_cover', 'weak_tie', 'balance', 'history_avoid'] as const;
  const deltas: Record<string, number> = {
    total: Number((afterScore.scores.total - before.scores.total).toFixed(2))
  };
  for (const d of dims) {
    deltas[d] = Number((afterScore.scores[d] - before.scores[d]).toFixed(2));
  }
  return {
    ok: afterScore.violations.length === 0,
    violations: afterScore.violations,
    deltas,
    totalBefore: before.scores.total,
    totalAfter: afterScore.scores.total,
    groups: after
  };
}

/** 应用一次拖动/互换：校验通过才落库（更新 plan 的分组快照与总分）。 */
export async function applyMove(planId: number, move: GroupingMoveInput | GroupingSwapInput) {
  const plan = await getPlan(planId);
  const after = applyMoveToGroups(plan.groups, move);
  const scored = await scoreGroups(plan.courseId, after, plan.weights ?? {});
  if (scored.violations.length > 0) {
    return { ok: false as const, violations: scored.violations };
  }
  await db
    .update(groupingPlans)
    .set({ groups: after, totalScore: String(scored.scores.total) })
    .where(eq(groupingPlans.id, planId));
  return { ok: true as const, groups: after, totalScore: scored.scores.total };
}

/** 还原到求解器原始结果。 */
export async function resetPlan(planId: number) {
  const plan = await getPlan(planId);
  const scored = await scoreGroups(plan.courseId, plan.originalGroups, plan.weights ?? {});
  await db
    .update(groupingPlans)
    .set({ groups: plan.originalGroups, totalScore: String(scored.scores.total) })
    .where(eq(groupingPlans.id, planId));
  return { ok: true as const, groups: plan.originalGroups, totalScore: scored.scores.total };
}

/**
 * 选定方案并落库（规格书 B-06 select）：
 * 生成 groups + group_members；已有进行中的分组时拒绝（需先解散）。
 */
export async function selectPlan(planId: number, teacherId: number) {
  const plan = await getPlan(planId);

  const [existing] = await db
    .select()
    .from(groups)
    .where(and(eq(groups.courseId, plan.courseId), eq(groups.status, 'active')))
    .limit(1);
  if (existing) {
    return { error: '该课程已有进行中的分组，请先解散后再选定新方案' as const };
  }

  return db.transaction(async (tx) => {
    await tx
      .update(groupingPlans)
      .set({ isSelected: false })
      .where(eq(groupingPlans.runId, plan.runId));

    await tx
      .update(groupingPlans)
      .set({ isSelected: true, selectedAt: new Date(), selectedBy: teacherId })
      .where(eq(groupingPlans.id, planId));

    for (let gi = 0; gi < plan.groups.length; gi++) {
      const memberIds = plan.groups[gi];
      if (memberIds.length === 0) continue;
      const [group] = await tx
        .insert(groups)
        .values({
          courseId: plan.courseId,
          planId,
          name: `第${gi + 1}组`,
          status: 'active'
        })
        .returning();
      await tx.insert(groupMembers).values(
        memberIds.map((userId) => ({
          groupId: group.id,
          userId,
          duty: 'contributor' as const
        }))
      );
    }
    return { ok: true as const };
  });
}

/** 课程的小组列表（含成员）。 */
export async function listGroups(courseId: number) {
  const groupRows = await db
    .select()
    .from(groups)
    .where(eq(groups.courseId, courseId))
    .orderBy(groups.id);

  const memberRows = await db
    .select({
      groupId: groupMembers.groupId,
      userId: groupMembers.userId,
      duty: groupMembers.duty,
      name: users.name,
      studentNo: users.studentNo
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .where(isNull(groupMembers.leftAt));

  return groupRows.map((g) => ({
    ...g,
    members: memberRows
      .filter((m) => m.groupId === g.id)
      .map((m) => ({ userId: m.userId, name: m.name, studentNo: m.studentNo, duty: m.duty }))
  }));
}

async function getPlan(planId: number) {
  const [plan] = await db
    .select()
    .from(groupingPlans)
    .where(eq(groupingPlans.id, planId))
    .limit(1);
  if (!plan) throw new Error('方案不存在');
  const [run] = await db
    .select()
    .from(groupingRuns)
    .where(eq(groupingRuns.id, plan.runId))
    .limit(1);
  if (!run) throw new Error('求解记录不存在');
  return { ...plan, courseId: run.courseId };
}

/** 方案所属课程 id（供 API 层做课程归属鉴权）。 */
export async function getPlanCourseId(planId: number): Promise<number | null> {
  try {
    const plan = await getPlan(planId);
    return plan.courseId;
  } catch {
    return null;
  }
}

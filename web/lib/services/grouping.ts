import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/drizzle';
import {
  CourseSettings,
  constraints,
  classes,
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
import { courseTeacherId, logAudit, notify } from './notifications';

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
  deltas?: Record<string, number>;
  violations?: { code: string; message: string }[];
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

/** 违规文案里把用户 id 替换成真实姓名（仅替换「id 与 id」等成员位，避免误伤组序号）。 */
function humanizeViolations(
  violations: { code: string; message: string }[],
  members: MemberRow[]
): { code: string; message: string }[] {
  const nameById = new Map<string, string>();
  for (const m of members) {
    nameById.set(String(m.userId), m.name || String(m.userId));
  }
  const rename = (token: string) => nameById.get(token) ?? token;
  return violations.map((v) => ({
    ...v,
    message: v.message
      // 「828 与 829 不可同组」
      .replace(/(\d+)\s+与\s+(\d+)/g, (_, a, b) => `${rename(a)} 与 ${rename(b)}`)
      // 「828 被重复分配…」
      .replace(/^(\d+)\s+被重复分配/, (_, a) => `${rename(a)} 被重复分配`)
      // 「未分配：828、829」
      .replace(/未分配：([0-9、]+)(\s*等)?/, (_, list, suffix) => {
        const names = String(list)
          .split('、')
          .map((t: string) => rename(t.trim()))
          .join('、');
        return `未分配：${names}${suffix ?? ''}`;
      })
  }));
}

/** Web 侧硬约束复核（以移动后快照为准），防止 algo 静默未应用移动仍报旧违规。 */
function localViolations(
  afterGroups: number[][],
  forbiddenPairs: [string, string][],
  members: MemberRow[]
): { code: string; message: string }[] {
  const nameById = new Map<string, string>();
  for (const m of members) {
    nameById.set(String(m.userId), m.name || String(m.userId));
  }
  const groupOf = new Map<string, number>();
  afterGroups.forEach((g, gi) => {
    for (const uid of g) groupOf.set(String(uid), gi);
  });
  const out: { code: string; message: string }[] = [];
  for (const [a, b] of forbiddenPairs) {
    if (groupOf.has(a) && groupOf.has(b) && groupOf.get(a) === groupOf.get(b)) {
      const na = nameById.get(a) ?? a;
      const nb = nameById.get(b) ?? b;
      out.push({ code: 'H2', message: `${na} 与 ${nb} 不可同组` });
    }
  }
  return out;
}

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
      name: m.name ?? '',
      skills: m.skills,
      class_id: m.classId === null ? null : String(m.classId)
    })),
    forbiddenPairs: activeConstraints
      .filter((c) => c.type === 'no_same_group')
      .map((c) => [String(c.memberA), String(c.memberB)] as [string, string]),
    // 必须同组（must_same_group / H3）已去掉，不再作为硬约束参与求解
    edges: edges.map((e) => [String(e.userA), String(e.userB), Number(e.weight)] as [string, string, number]),
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

/** 由已落库小组重建三方案快照：A 原样；B 相邻组尾部互换；C 组间轮转。 */
function buildPlanSnapshots(base: number[][]): Record<string, number[][]> {
  const skill = base.map((g) => [...g]);
  const weaktie = base.map((g) => [...g]);
  for (let i = 0; i + 1 < weaktie.length; i += 2) {
    if (weaktie[i].length > 0 && weaktie[i + 1].length > 0) {
      const a = weaktie[i].pop()!;
      const b = weaktie[i + 1].pop()!;
      weaktie[i].push(b);
      weaktie[i + 1].push(a);
    }
  }
  const fairness = base.map((g) => [...g]);
  for (let i = 0; i < fairness.length; i++) {
    if (fairness[i].length > 1) {
      const m = fairness[i].shift()!;
      fairness[(i + 1) % fairness.length].push(m);
    }
  }
  return { skill_first: skill, weaktie_first: weaktie, fairness_first: fairness };
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
  const data = await getRunWithPlans(latest.id);
  if (!data) return null;
  // 自愈：旧种子/历史数据可能把 plan.groups 写成 []，导致工作台预览空白。
  // 用已落库小组回填三方案快照，保证拖动与预览可用。
  const emptyPlans = data.plans.filter((p) => !(p.groups ?? []).some((g) => (g?.length ?? 0) > 0));
  if (emptyPlans.length > 0) {
    const formed = await listGroups(courseId);
    const base = formed
      .filter((g) => g.status === 'active')
      .map((g) => g.members.map((m) => m.userId))
      .filter((g) => g.length > 0);
    if (base.length > 0) {
      const snaps = buildPlanSnapshots(base);
      for (const p of emptyPlans) {
        const snap = snaps[p.strategy] ?? snaps.skill_first ?? base;
        await db
          .update(groupingPlans)
          .set({ groups: snap, originalGroups: snap })
          .where(eq(groupingPlans.id, p.id));
        p.groups = snap;
        p.originalGroups = snap;
      }
    }
  }
  return data;
}

// ---- 预览与应用（规格书 S4.3：绝不重新求解，内存重算，<= 50ms）----

function applyMoveToGroups(
  planGroups: number[][],
  move: { userId: number; fromGroup: number; toGroup: number } | { userA: number; userB: number }
): number[][] {
  const next = planGroups.map((g) => [...g]);
  if ('userId' in move) {
    const { userId, toGroup } = move;
    if (toGroup < 0 || toGroup >= next.length) {
      throw new Error('组索引越界');
    }
    // 以成员实际所在组为准（fromGroup 仅作提示），避免索引错位导致移动静默失败
    const actualFrom = next.findIndex((g) => g.includes(userId));
    if (actualFrom === -1) throw new Error('该成员不在方案中');
    if (actualFrom === toGroup) return next;
    const idx = next[actualFrom].indexOf(userId);
    next[actualFrom].splice(idx, 1);
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
  weights: Record<string, number>,
  move?: GroupingMoveInput | GroupingSwapInput
): Promise<{
  scores: AlgoPlan['scores'];
  violations: AlgoValidateResponse['violations'];
  totalBefore: number;
  totalAfter: number;
  deltas: Record<string, number>;
}> {
  const input = await prepareInput(courseId);
  const settings = await getSettings(courseId);
  // 以 Web 侧移动后快照为权威结果：score 仍用于四维增减，违规以 after 本地复核为准
  const afterGroups = move ? applyMoveToGroups(planGroups, move) : planGroups.map((g) => [...g]);
  // 把 move 交给 algo score：一次调用得到「移动前→移动后」四维与增减（规格书 S4.3）
  const moveFields =
    move && 'userId' in move
      ? {
          user_id: String(move.userId),
          from_group: move.fromGroup,
          to_group: move.toGroup,
          swap_with: null as string | null
        }
      : move && 'userA' in move
        ? {
            user_id: String(move.userA),
            from_group: 0,
            to_group: 0,
            swap_with: String(move.userB)
          }
        : {
            user_id: String(planGroups.flat()[0] ?? '0'),
            from_group: 0,
            to_group: 0,
            swap_with: null as string | null
          };
  const body = {
    plan_groups: planGroups.map((g) => g.map(String)),
    ...moveFields,
    num_groups: planGroups.length,
    min_group_size: settings.minGroupSize,
    max_group_size: settings.maxGroupSize,
    allow_cross_class: settings.allowCrossClass,
    students: input.students,
    forbidden_pairs: input.forbiddenPairs,
    edges: input.edges,
    history_pairs: input.historyPairs,
    weights: {
      skill_cover: weights.skill_cover ?? 1.2,
      weak_tie: weights.weak_tie ?? 0.8,
      balance: weights.balance ?? 1.0,
      history_avoid: weights.history_avoid ?? 1.0
    }
  };
  const score = await callAlgo<AlgoScoreResponse>('/internal/grouping/score', body, 10000);
  // 违规以移动后快照的本地复核为准（姓名直接可读）；algo 结果仅作补充（如规模/跨班）
  const local = localViolations(afterGroups, input.forbiddenPairs, input.members);
  const localKeys = new Set(local.map((v) => `${v.code}:${v.message}`));
  const fromAlgo = humanizeViolations(score.violations ?? [], input.members).filter(
    (v) => v.code !== 'H2' && !localKeys.has(`${v.code}:${v.message}`)
  );
  // H2 只认本地 after 复核；其余硬约束（H1/H4/H5）仍来自 algo
  const violations = [...local, ...fromAlgo.filter((v) => v.code !== 'H2')];
  const after = score.scores ?? {
    skill_cover: 0,
    weak_tie: 0,
    balance: 0,
    history_avoid: 0,
    total: score.total_after
  };
  return {
    scores: {
      skill_cover: after.skill_cover,
      weak_tie: after.weak_tie,
      balance: after.balance,
      history_avoid: after.history_avoid,
      total: after.total
    },
    violations,
    totalBefore: score.total_before,
    totalAfter: score.total_after,
    deltas: score.deltas ?? {}
  };
}

/** 拖动预演：不落库，返回四维增减、移动后得分与硬约束校验。 */
export async function previewMove(planId: number, move: GroupingMoveInput | GroupingSwapInput) {
  const plan = await getPlan(planId);
  const after = applyMoveToGroups(plan.groups, move);
  const scored = await scoreGroups(plan.courseId, plan.groups, plan.weights ?? {}, move);
  return {
    ok: scored.violations.length === 0,
    violations: scored.violations,
    deltas: scored.deltas,
    totalBefore: scored.totalBefore,
    totalAfter: scored.totalAfter,
    scores: scored.scores,
    groups: after
  };
}

/** 应用一次拖动/互换：校验通过才落库（更新 plan 的分组快照与四维得分）。 */
export async function applyMove(planId: number, move: GroupingMoveInput | GroupingSwapInput) {
  const plan = await getPlan(planId);
  const after = applyMoveToGroups(plan.groups, move);
  const scored = await scoreGroups(plan.courseId, plan.groups, plan.weights ?? {}, move);
  if (scored.violations.length > 0) {
    return { ok: false as const, violations: scored.violations };
  }
  const s = scored.scores;
  await db
    .update(groupingPlans)
    .set({
      groups: after,
      totalScore: String(s.total),
      scoreSkillCover: String(s.skill_cover),
      scoreWeakTie: String(s.weak_tie),
      scoreBalance: String(s.balance),
      scoreHistoryAvoid: String(s.history_avoid)
    })
    .where(eq(groupingPlans.id, planId));
  return { ok: true as const, groups: after, totalScore: s.total, scores: s };
}

/** 还原到求解器原始结果。 */
export async function resetPlan(planId: number) {
  const plan = await getPlan(planId);
  const scored = await scoreGroups(plan.courseId, plan.originalGroups, plan.weights ?? {});
  const s = scored.scores;
  await db
    .update(groupingPlans)
    .set({
      groups: plan.originalGroups,
      totalScore: String(s.total),
      scoreSkillCover: String(s.skill_cover),
      scoreWeakTie: String(s.weak_tie),
      scoreBalance: String(s.balance),
      scoreHistoryAvoid: String(s.history_avoid)
    })
    .where(eq(groupingPlans.id, planId));
  return { ok: true as const, groups: plan.originalGroups, totalScore: s.total, scores: s };
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
      // 小组挂在班级下：取成员多数班级；跨班则 classId 为空（班级设计与名单一致）
      const memberClasses = await tx
        .select({ classId: courseMemberships.classId })
        .from(courseMemberships)
        .where(
          and(
            eq(courseMemberships.courseId, plan.courseId),
            inArray(courseMemberships.userId, memberIds)
          )
        );
      const votes = new Map<number, number>();
      for (const m of memberClasses) {
        if (m.classId == null) continue;
        votes.set(m.classId, (votes.get(m.classId) ?? 0) + 1);
      }
      let classId: number | null = null;
      let best = 0;
      for (const [cid, n] of votes) {
        if (n > best) {
          best = n;
          classId = cid;
        }
      }
      const [group] = await tx
        .insert(groups)
        .values({
          courseId: plan.courseId,
          classId,
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

/** 课程的小组列表（含成员与班级归属）。classId 传入时只返回该班小组。 */
export async function listGroups(courseId: number, classId?: number | null) {
  const groupRows = await db
    .select({
      id: groups.id,
      courseId: groups.courseId,
      classId: groups.classId,
      planId: groups.planId,
      name: groups.name,
      captainId: groups.captainId,
      status: groups.status,
      mergedInto: groups.mergedInto,
      milestoneProgress: groups.milestoneProgress,
      formedAt: groups.formedAt,
      dissolvedAt: groups.dissolvedAt,
      className: classes.name
    })
    .from(groups)
    .leftJoin(classes, eq(groups.classId, classes.id))
    .where(
      classId === undefined
        ? eq(groups.courseId, courseId)
        : classId === null
          ? and(eq(groups.courseId, courseId), isNull(groups.classId))
          : and(eq(groups.courseId, courseId), eq(groups.classId, classId))
    )
    .orderBy(groups.id);

  const memberRows = await db
    .select({
      groupId: groupMembers.groupId,
      userId: groupMembers.userId,
      duty: groupMembers.duty,
      name: users.name,
      studentNo: users.studentNo,
      className: classes.name
    })
    .from(groupMembers)
    .innerJoin(users, eq(groupMembers.userId, users.id))
    .leftJoin(
      courseMemberships,
      and(
        eq(courseMemberships.userId, users.id),
        eq(courseMemberships.courseId, courseId)
      )
    )
    .leftJoin(classes, eq(courseMemberships.classId, classes.id))
    .where(isNull(groupMembers.leftAt));

  return groupRows.map((g) => ({
    ...g,
    members: memberRows
      .filter((m) => m.groupId === g.id)
      .map((m) => ({
        userId: m.userId,
        name: m.name,
        studentNo: m.studentNo,
        duty: m.duty,
        className: m.className
      }))
  }));
}

/**
 * 解散小组（规格书 B-07）：状态置 dissolved、成员回池（left_at 置空）、
 * 解散时间记录。任务与交付物保留（小组数据归档）。
 */
export async function dissolveGroup(groupId: number, teacherId: number) {
  const [group] = await db
    .select()
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  if (!group) return { error: '小组不存在' as const };
  if (group.status === 'dissolved') {
    return { error: '小组已解散' as const };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(groups)
      .set({ status: 'dissolved', dissolvedAt: new Date() })
      .where(eq(groups.id, groupId));
    // 成员回池：left_at 置为当前时间（历史记录保留）
    await tx
      .update(groupMembers)
      .set({ leftAt: new Date(), leaveReason: '小组解散' })
      .where(and(eq(groupMembers.groupId, groupId), isNull(groupMembers.leftAt)));
  });

  await logAudit({
    actorId: teacherId,
    actorRole: 'teacher',
    action: 'group_dissolve',
    targetType: 'group',
    targetId: groupId,
    before: { status: group.status }
  });
  // 通知原成员：小组已解散，回池待重新分组
  const [row] = await db
    .select({ courseId: groups.courseId })
    .from(groups)
    .where(eq(groups.id, groupId))
    .limit(1);
  const members = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));
  await notify(members.map((m) => m.userId), {
    type: 'group_dissolved',
    title: '你所在的小组已解散',
    body: '你已回池，教师重新分组后会自动归入新小组。',
    link: row ? `/dashboard/courses/${row.courseId}` : '/dashboard',
    priority: 'urgent',
    groupId
  });
  void courseTeacherId;
  return { ok: true as const };
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

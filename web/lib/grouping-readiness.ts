/**
 * 分组就绪度与可行性诊断（纯函数，不碰库、不调算法）。
 *
 * 为什么要有这一层：
 *
 * 1. 求解器返回无解时只说「无可行解」，教师不知道该改哪一个数。algo 侧的
 *    规模自检是 `n < num_groups * min_size or n > num_groups * max_size`
 *    （algo/app/algorithms/grouping.py:401），这里用同一套判据**在点按钮之前**
 *    就把「差几个人」「组数最多能设几个」算出来，把不可行变成一组可操作建议。
 * 2. 工作台上「没有方案」有五种完全不同的成因（没名单、没跑过、正在跑、
 *    无解、报错），此前都显示成同一个空态。教师会以为是 bug 而反复点生成，
 *    或以为要重填名单。stage 把它们分开。
 *
 * 刻意与 algo 保持一致的常量：algo 超过 MAX_STUDENTS_FOR_CPSAT 会退贪心，
 * 这里也据此提示「人数多，可能走快速模式」。
 */

/** 与 algo/app/algorithms/grouping.py:51 MAX_STUDENTS_FOR_CPSAT 对齐。 */
export const MAX_STUDENTS_FOR_CPSAT = 200;

export type FeasibilityParams = {
  studentCount: number;
  groupCount: number;
  minGroupSize: number;
  maxGroupSize: number;
};

export type FeasibilityIssue = {
  code: 'NO_STUDENTS' | 'BAD_SIZE_RANGE' | 'TOO_FEW_STUDENTS' | 'TOO_MANY_STUDENTS' | 'GAP_TOO_LARGE';
  /** 问题本身，说明「现在是什么情况」 */
  message: string;
  /** 怎么改：给出具体可设的数值，而不是「请调整约束」 */
  suggestion: string;
};

export type FeasibilityResult = {
  feasible: boolean;
  issues: FeasibilityIssue[];
  /** 当前人数能容下的组数区间（闭区间）；人数为 0 或规模范围非法时为 null */
  groupCountRange: { min: number; max: number } | null;
  /** 当前组数能容下的每组人数区间（闭区间）；同上为 null */
  sizeRange: { min: number; max: number } | null;
  /** 可能退化为贪心（人数超过 CP-SAT 上限） */
  mayFallBackToGreedy: boolean;
};

/**
 * 诊断当前设置能否分得动。
 *
 * 判据与 algo 一致：可容纳人数区间是 [组数×下限, 组数×上限]，
 * 学生数落在这个区间外就是先天不可行。
 */
export function diagnoseFeasibility(params: FeasibilityParams): FeasibilityResult {
  const { studentCount, groupCount, minGroupSize, maxGroupSize } = params;
  const issues: FeasibilityIssue[] = [];

  if (minGroupSize > maxGroupSize) {
    issues.push({
      code: 'BAD_SIZE_RANGE',
      message: `每组人数下限 ${minGroupSize} 大于上限 ${maxGroupSize}，这样任何人数都排不满。`,
      suggestion: `把下限调到不大于上限，例如 ${maxGroupSize}–${maxGroupSize} 或 ${Math.min(minGroupSize, maxGroupSize)}–${Math.max(minGroupSize, maxGroupSize)}。`
    });
  }

  if (studentCount <= 0) {
    issues.push({
      code: 'NO_STUDENTS',
      message: '课程名单里还没有学生，分组的输入是空的。',
      suggestion: '先到「名单与班级」导入学生，再回来生成分组方案。'
    });
  }

  const rangeValid = minGroupSize > 0 && maxGroupSize >= minGroupSize && groupCount > 0;
  const groupCountRange = rangeValid && studentCount > 0
    ? {
        min: Math.ceil(studentCount / maxGroupSize),
        max: Math.floor(studentCount / minGroupSize)
      }
    : null;
  const sizeRange = rangeValid && studentCount > 0
    ? {
        min: Math.ceil(studentCount / groupCount),
        max: Math.floor(studentCount / groupCount)
      }
    : null;

  if (rangeValid && studentCount > 0) {
    const capacity = { min: groupCount * minGroupSize, max: groupCount * maxGroupSize };

    if (studentCount < capacity.min) {
      const gap = capacity.min - studentCount;
      issues.push({
        code: 'TOO_FEW_STUDENTS',
        message: `${studentCount} 人填不满 ${groupCount} 组 × 每组至少 ${minGroupSize} 人（缺 ${gap} 人）。`,
        suggestion:
          groupCountRange && groupCountRange.max >= 1
            ? `把组数降到 ${Math.max(1, groupCountRange.max)} 组以内，或把每组下限降到 ${Math.max(1, Math.floor(studentCount / groupCount))} 人。`
            : `减少组数或降低每组人数下限（当前 ${studentCount} 人最多只能凑出 ${Math.max(1, Math.floor(studentCount / minGroupSize))} 个满组）。`
      });
    }

    if (studentCount > capacity.max) {
      const surplus = studentCount - capacity.max;
      issues.push({
        code: 'TOO_MANY_STUDENTS',
        message: `${studentCount} 人装不进 ${groupCount} 组 × 每组最多 ${maxGroupSize} 人（多出 ${surplus} 人）。`,
        suggestion:
          groupCountRange && groupCountRange.min > groupCount
            ? `把组数提到至少 ${groupCountRange.min} 组，或把每组上限提到 ${Math.ceil(studentCount / groupCount)} 人。`
            : `增加组数或提高每组人数上限（当前至少需要 ${Math.ceil(studentCount / maxGroupSize)} 个组）。`
      });
    }

    // 区间虽合法但空隙很大：容易在求解时来回调整，给出提示而不算错误
    if (groupCountRange && groupCountRange.min > groupCountRange.max) {
      issues.push({
        code: 'GAP_TOO_LARGE',
        message: `按当前每组 ${minGroupSize}–${maxGroupSize} 人的限制，${studentCount} 人凑不出整数个满足规模的组。`,
        suggestion: `把每组人数范围放宽到能整除的形式，例如让 ${Math.ceil(studentCount / Math.max(1, groupCount))} 人左右为一组。`
      });
    }
  }

  return {
    feasible: !issues.some((i) => i.code !== 'GAP_TOO_LARGE'),
    issues,
    groupCountRange,
    sizeRange,
    mayFallBackToGreedy: studentCount > MAX_STUDENTS_FOR_CPSAT
  };
}

// ---------------------------------------------------------------------------
// 分组工作台的阶段判定
// ---------------------------------------------------------------------------

export type GroupingStage =
  /** 名单为空，什么都做不了 */
  | 'roster-empty'
  /** 名单就绪但从未求解 */
  | 'not-generated'
  /** 上次求解还在跑 */
  | 'running'
  /** 上次求解无解（规模/约束冲突） */
  | 'infeasible'
  /** 上次求解报错（算法服务不可用等） */
  | 'failed'
  /** 有三套方案待选 */
  | 'plans-ready'
  /** 已有落库小组（已选定） */
  | 'selected';

export type GroupingStageInput = {
  studentCount: number;
  /** 最近一次求解记录；从未求解传 null */
  latestRun: { status: string; degraded: boolean | null; errorDetail: string | null } | null;
  /** 最近一次成功求解是否已有可用方案 */
  hasPlans: boolean;
  /** 是否已有 active 小组（即已选定落库） */
  activeGroupCount: number;
};

export type GroupingStageInfo = {
  stage: GroupingStage;
  /** 一句话说明现在处于哪一步 */
  title: string;
  /** 下一步该做什么 */
  nextAction: string;
  /** 是否可以点「生成分组方案」 */
  canGenerate: boolean;
  /** 是否为算法降级产出的方案（贪心兜底，不等于最优） */
  degraded: boolean;
};

/**
 * 判定分组流程所处的阶段。
 *
 * 顺序很重要：已落库的小组优先于求解记录——教师选定方案后若又点了一次生成，
 * 页面上「已选定」这件事不能被新的未选方案盖掉，否则他会以为自己没选成功。
 */
export function deriveGroupingStage(input: GroupingStageInput): GroupingStageInfo {
  const { studentCount, latestRun, hasPlans, activeGroupCount } = input;

  if (activeGroupCount > 0) {
    return {
      stage: 'selected',
      title: `已选定方案，${activeGroupCount} 个小组已落库`,
      nextAction: '接下来到「任务与契约」把作业要求拆成任务；需要重分的话先解散现有分组。',
      canGenerate: false,
      degraded: false
    };
  }

  if (studentCount <= 0) {
    return {
      stage: 'roster-empty',
      title: '名单为空，无法生成分组',
      nextAction: '先到「名单与班级」导入学生。',
      canGenerate: false,
      degraded: false
    };
  }

  if (latestRun?.status === 'running') {
    return {
      stage: 'running',
      title: '正在求解分组方案',
      nextAction: '求解通常 10 秒内完成，稍等片刻再刷新。',
      canGenerate: false,
      degraded: false
    };
  }

  if (hasPlans) {
    const degraded = latestRun?.degraded === true;
    return {
      stage: 'plans-ready',
      title: degraded ? '已生成三套方案（快速模式）' : '已生成三套方案',
      nextAction: degraded
        ? '求解器超时回退贪心，结果未达最优。可以直接选定，也可以调整约束后重新求解。'
        : '对比三套方案、拖动微调，确认后点「选定此方案」。',
      canGenerate: true,
      degraded
    };
  }

  if (latestRun?.status === 'infeasible') {
    return {
      stage: 'infeasible',
      title: '上次求解无可行解',
      nextAction: latestRun.errorDetail || '调整组数、每组人数或不可同组配对后再试。',
      canGenerate: true,
      degraded: false
    };
  }

  if (latestRun && (latestRun.status === 'error' || latestRun.status === 'timeout')) {
    return {
      stage: 'failed',
      title: '上次求解失败',
      nextAction: latestRun.errorDetail || '稍后重试；已有方案与设置不会因此丢失。',
      canGenerate: true,
      degraded: false
    };
  }

  return {
    stage: 'not-generated',
    title: '还没有生成过分组方案',
    nextAction: '确认名单已导入、技能卡已填写，然后点「生成分组方案」。',
    canGenerate: true,
    degraded: false
  };
}
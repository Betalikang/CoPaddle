import { describe, it, expect } from 'vitest';
import {
  MAX_STUDENTS_FOR_CPSAT,
  diagnoseFeasibility,
  deriveGroupingStage,
  type GroupingStageInput
} from '@/lib/grouping-readiness';

describe('diagnoseFeasibility', () => {
  it('人数落在容量区间内时可行且无 issue', () => {
    const r = diagnoseFeasibility({ studentCount: 40, groupCount: 8, minGroupSize: 3, maxGroupSize: 6 });
    expect(r.feasible).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.groupCountRange).toEqual({ min: 7, max: 13 });
    expect(r.sizeRange).toEqual({ min: 5, max: 5 });
    expect(r.mayFallBackToGreedy).toBe(false);
  });

  it('人数不足时给出缺口与可设的组数上限', () => {
    const r = diagnoseFeasibility({ studentCount: 10, groupCount: 8, minGroupSize: 3, maxGroupSize: 6 });
    expect(r.feasible).toBe(false);
    const issue = r.issues.find((i) => i.code === 'TOO_FEW_STUDENTS');
    expect(issue).toBeDefined();
    // 10 人 vs 8×3=24 人，缺 14
    expect(issue!.message).toContain('缺 14 人');
    // 10 人最多凑 3 个满组（floor(10/3)）
    expect(r.groupCountRange).toEqual({ min: 2, max: 3 });
    expect(issue!.suggestion).toContain('3');
  });

  it('人数过多时给出多出人数与建议组数', () => {
    const r = diagnoseFeasibility({ studentCount: 60, groupCount: 8, minGroupSize: 3, maxGroupSize: 6 });
    expect(r.feasible).toBe(false);
    const issue = r.issues.find((i) => i.code === 'TOO_MANY_STUDENTS');
    expect(issue).toBeDefined();
    // 60 人 vs 8×6=48，多 12
    expect(issue!.message).toContain('多出 12 人');
    // 60 人至少需要 ceil(60/6)=10 组
    expect(r.groupCountRange).toEqual({ min: 10, max: 20 });
    expect(issue!.suggestion).toContain('10');
  });

  it('名单为空时提示先导名单，且不计算区间', () => {
    const r = diagnoseFeasibility({ studentCount: 0, groupCount: 8, minGroupSize: 3, maxGroupSize: 6 });
    expect(r.feasible).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('NO_STUDENTS');
    expect(r.groupCountRange).toBeNull();
    expect(r.sizeRange).toBeNull();
  });

  it('下限大于上限时单独报出，不连带算出错误区间', () => {
    const r = diagnoseFeasibility({ studentCount: 40, groupCount: 8, minGroupSize: 6, maxGroupSize: 3 });
    expect(r.feasible).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('BAD_SIZE_RANGE');
    expect(r.groupCountRange).toBeNull();
  });

  it('超过 CP-SAT 上限时标记可能退化为贪心，但仍算可行', () => {
    const r = diagnoseFeasibility({
      studentCount: MAX_STUDENTS_FOR_CPSAT + 1,
      groupCount: 50,
      minGroupSize: 4,
      maxGroupSize: 8
    });
    expect(r.mayFallBackToGreedy).toBe(true);
    expect(r.feasible).toBe(true);
  });

  it('边界值：恰好在容量区间两端时可行', () => {
    const low = diagnoseFeasibility({ studentCount: 24, groupCount: 8, minGroupSize: 3, maxGroupSize: 6 });
    expect(low.feasible).toBe(true);
    const high = diagnoseFeasibility({ studentCount: 48, groupCount: 8, minGroupSize: 3, maxGroupSize: 6 });
    expect(high.feasible).toBe(true);
  });
});

describe('deriveGroupingStage', () => {
  const base: GroupingStageInput = {
    studentCount: 40,
    latestRun: null,
    hasPlans: false,
    activeGroupCount: 0
  };

  it('已落库小组优先于一切：即使又有新方案也不显示未选定', () => {
    const r = deriveGroupingStage({
      ...base,
      latestRun: { status: 'ok', degraded: false, errorDetail: null },
      hasPlans: true,
      activeGroupCount: 8
    });
    expect(r.stage).toBe('selected');
    expect(r.canGenerate).toBe(false);
    expect(r.title).toContain('8 个小组');
  });

  it('名单为空时禁止生成', () => {
    const r = deriveGroupingStage({ ...base, studentCount: 0 });
    expect(r.stage).toBe('roster-empty');
    expect(r.canGenerate).toBe(false);
  });

  it('求解中时禁止重复点生成', () => {
    const r = deriveGroupingStage({
      ...base,
      latestRun: { status: 'running', degraded: null, errorDetail: null }
    });
    expect(r.stage).toBe('running');
    expect(r.canGenerate).toBe(false);
  });

  it('有方案时区分正常与快速模式', () => {
    const normal = deriveGroupingStage({
      ...base,
      latestRun: { status: 'ok', degraded: false, errorDetail: null },
      hasPlans: true
    });
    expect(normal.stage).toBe('plans-ready');
    expect(normal.degraded).toBe(false);

    const degraded = deriveGroupingStage({
      ...base,
      latestRun: { status: 'ok', degraded: true, errorDetail: null },
      hasPlans: true
    });
    expect(degraded.stage).toBe('plans-ready');
    expect(degraded.degraded).toBe(true);
    expect(degraded.nextAction).toContain('贪心');
  });

  it('无可行解时把 errorDetail 当作下一步说明', () => {
    const r = deriveGroupingStage({
      ...base,
      latestRun: { status: 'infeasible', degraded: null, errorDetail: '40 人无法分成 8 组' }
    });
    expect(r.stage).toBe('infeasible');
    expect(r.nextAction).toBe('40 人无法分成 8 组');
    expect(r.canGenerate).toBe(true);
  });

  it('求解报错与超时都归为 failed，且允许重试', () => {
    for (const status of ['error', 'timeout']) {
      const r = deriveGroupingStage({
        ...base,
        latestRun: { status, degraded: null, errorDetail: null }
      });
      expect(r.stage).toBe('failed');
      expect(r.canGenerate).toBe(true);
      // 缺 detail 时不能直接显示空字符串
      expect(r.nextAction.length).toBeGreaterThan(0);
    }
  });

  it('从未求解时提示确认名单与技能卡', () => {
    const r = deriveGroupingStage(base);
    expect(r.stage).toBe('not-generated');
    expect(r.nextAction).toContain('技能卡');
  });
});